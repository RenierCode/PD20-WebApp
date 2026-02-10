"""
# processData.py - Batch Anomaly Detection CLI
# See DOCS.md in project root for full documentation
"""
import pymongo
from datetime import datetime, timezone
import os
import argparse
from pathlib import Path
from dotenv import load_dotenv

# Import shared config
from config import MODELS_DIR, SENSOR_MODEL_MAP, THRESHOLDS

# =============================================================================
# ENVIRONMENT AND DATABASE SETUP
# =============================================================================

# Load environment variables from .env file
load_dotenv()
MONGO_URI = os.getenv("DATABASE_URL")  # MongoDB Atlas connection string
DB_NAME = "sensorDB"                    # Database name
READINGS_COLLECTION = "sensorReadings"  # Collection with sensor data

if not MONGO_URI:
    raise Exception("DATABASE_URL not found in .env file.")

# Establish MongoDB connection
print("Connecting to MongoDB Atlas...")
try:
    client = pymongo.MongoClient(MONGO_URI)
    db = client[DB_NAME]
    readings_collection = db[READINGS_COLLECTION]
    client.admin.command('ping')  # Verify connection works
    print("MongoDB connection successful.")
except Exception as e:
    print(f"Error connecting to MongoDB: {e}")
    exit(1)

# =============================================================================
# MODEL LOADING
# =============================================================================

def load_models():
    """
    Load Isolation Forest models from the models directory.
    
    Returns a dict mapping sensor names to loaded sklearn models.
    Returns empty dict if joblib is not installed.
    """
    try:
        import joblib
    except ImportError:
        print("Warning: joblib not installed. Run: pip install joblib")
        return {}
    
    models = {}
    for sensor, filename in SENSOR_MODEL_MAP.items():
        model_path = MODELS_DIR / filename
        if model_path.exists():
            try:
                models[sensor] = joblib.load(model_path)
                print(f"  [OK] Loaded model for '{sensor}'")
            except Exception as e:
                print(f"  [FAIL] Failed to load model for '{sensor}': {e}")
    return models

# =============================================================================
# ANOMALY DETECTION FUNCTIONS
# =============================================================================

def check_anomaly_ml(sensor_key, value, models):
    """
    Check for anomaly using Isolation Forest model.
    Returns True if anomalous.
    """
    model = models.get(sensor_key)
    if model is None:
        return False
    
    try:
        numeric_value = float(value)
        # Isolation Forest: -1 = anomaly, 1 = normal
        prediction = model.predict([[numeric_value]])
        return prediction[0] == -1
    except Exception as e:
        return False

def check_anomaly_threshold(sensor_key, value):
    """
    Check for anomaly using threshold rules.
    Returns True if anomalous.
    """
    if sensor_key not in THRESHOLDS:
        return False
    
    rule = THRESHOLDS[sensor_key]
    try:
        numeric_value = float(value)
        if rule.get("min") is not None and numeric_value < rule["min"]:
            return True
        if rule.get("max") is not None and numeric_value > rule["max"]:
            return True
    except:
        pass
    return False

def check_for_anomalies(sensor_data, models=None, use_threshold=False):
    """
    Check all sensors in a reading for anomalies.
    Returns list of anomalous sensor keys.
    """
    # Sensors with broken ML models - always use threshold detection for these
    BROKEN_ML_SENSORS = {"flowRate", "flow_rate"}
    
    anomalies = []
    for sensor_key, value in sensor_data.items():
        if value is None:
            continue
        
        if use_threshold or sensor_key in BROKEN_ML_SENSORS:
            is_anomaly = check_anomaly_threshold(sensor_key, value)
        else:
            is_anomaly = check_anomaly_ml(sensor_key, value, models)
            # Fallback to threshold if no model available
            if not is_anomaly and models.get(sensor_key) is None:
                is_anomaly = check_anomaly_threshold(sensor_key, value)
        
        if is_anomaly:
            anomalies.append(sensor_key)
    
    return anomalies

def get_stats():
    """Print statistics about processed data."""
    total = readings_collection.count_documents({})
    processed = readings_collection.count_documents({"anomaly": {"$exists": True}})
    with_anomalies = readings_collection.count_documents({"anomaly": 1})
    
    print("\n--- Database Statistics ---")
    print(f"Total readings: {total}")
    print(f"Processed: {processed} ({processed/total*100:.1f}%)" if total > 0 else "Processed: 0")
    print(f"With anomalies: {with_anomalies}")
    
    # Per-sensor breakdown
    pipeline = [
        {"$match": {"anomalies": {"$exists": True, "$ne": []}}},
        {"$unwind": "$anomalies"},
        {"$group": {"_id": "$anomalies", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    sensor_counts = list(readings_collection.aggregate(pipeline))
    
    if sensor_counts:
        print("\nAnomalies by sensor:")
        for item in sensor_counts:
            print(f"  {item['_id']}: {item['count']}")

# --- Main Processing ---
def main():
    parser = argparse.ArgumentParser(description="Batch anomaly detection for sensor data")
    parser.add_argument("--all", action="store_true", help="Reprocess all data (not just unprocessed)")
    parser.add_argument("--node", type=str, help="Process only a specific node")
    parser.add_argument("--threshold", action="store_true", help="Use threshold-based detection instead of ML models")
    parser.add_argument("--stats", action="store_true", help="Show statistics only")
    args = parser.parse_args()
    
    print("=" * 50)
    print("Batch Anomaly Detection")
    print("=" * 50)
    
    if args.stats:
        get_stats()
        return
    
    # Load ML models if not using threshold mode
    models = {}
    if not args.threshold:
        print("\nLoading Isolation Forest models...")
        models = load_models()
        if not models:
            print("\nNo ML models found. Falling back to threshold-based detection.")
            args.threshold = True
        else:
            print(f"Loaded {len(set(models.values()))} models")
    
    if args.threshold:
        print(f"\nUsing threshold rules for: {list(THRESHOLDS.keys())}")
    
    # Build query
    query = {}
    if args.node:
        query["nodeId"] = args.node
        print(f"Filtering to node: {args.node}")
    if not args.all:
        query["anomaly"] = {"$exists": False}
    
    # Count documents
    total_count = readings_collection.count_documents(query)
    print(f"\nFound {total_count} readings to process")
    
    if total_count == 0:
        print("Nothing to process. Use --all to reprocess all data.")
        get_stats()
        return
    
    # Process in batches using skip for --all mode
    batch_size = 500
    documents_processed = 0
    anomalies_found = 0
    skip_count = 0
    
    print("\nProcessing...")
    
    while True:
        if args.all:
            # For --all mode, use skip to avoid reprocessing same documents
            cursor = readings_collection.find(query).skip(skip_count).limit(batch_size)
        else:
            # For normal mode, query always returns unprocessed docs
            cursor = readings_collection.find(query).limit(batch_size)
        
        documents = list(cursor)
        
        if not documents:
            break
        
        bulk_operations = []
        for doc in documents:
            sensor_data = doc.get("sensorData", {})
            anomalies = check_for_anomalies(sensor_data, models, args.threshold)
            
            update_fields = {
                "anomalies": anomalies,
                "anomaly": 1 if anomalies else 0,
                "anomaly_processed_at": datetime.now(timezone.utc).isoformat()
            }
            
            bulk_operations.append(
                pymongo.UpdateOne(
                    {"_id": doc["_id"]},
                    {"$set": update_fields}
                )
            )
            
            if anomalies:
                anomalies_found += 1
        
        if bulk_operations:
            result = readings_collection.bulk_write(bulk_operations)
            documents_processed += result.modified_count
        
        # Update skip counter for --all mode
        skip_count += len(documents)
        
        print(f"  Processed {documents_processed}/{total_count} ({anomalies_found} anomalies found)")
        
        if len(documents) < batch_size:
            break
    
    print(f"\n✓ Done! Processed {documents_processed} readings")
    get_stats()
    
    client.close()

if __name__ == "__main__":
    main()