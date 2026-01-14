import pymongo
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

# --- Load Environment Variables ---
load_dotenv()
MONGO_URI = os.getenv("DATABASE_URL")
DB_NAME = "sensorDB"
READINGS_COLLECTION = "sensorReadings"

if not MONGO_URI:
    raise Exception("DATABASE_URL not found in .env file.")

# --- Connect to MongoDB ---
print("Connecting to MongoDB Atlas...")
try:
    client = pymongo.MongoClient(MONGO_URI)
    db = client[DB_NAME]
    readings_collection = db[READINGS_COLLECTION]
    client.admin.command('ping')
    print("MongoDB connection successful.")
except Exception as e:
    print(f"Error connecting to MongoDB: {e}")
    exit(1)

# --- Anomaly Threshold Rules ---
THRESHOLDS = {
    # New sensor set: flowRate, waterLevel, pH, turbidity, waterTemperature
    # Thresholds chosen as reasonable defaults — adjust to your real-world specs
    "flowRate": {"min": 50.0, "max": 300.0},
    "waterLevel": {"min": 0.2, "max": 5.0},
    "pH": {"min": 6.5, "max": 8.0},
    "turbidity": {"min": 0.0, "max": 10.0},
    "temperature": {"min": 5.0, "max": 35.0},
}
print(f"Using threshold rules for: {list(THRESHOLDS.keys())}")

# --- Detection Function ---
def check_for_anomaly(sensor_data):
    """
    Checks each sensor value in the data against thresholds.
    Returns a list of sensor keys that are anomalous (empty list = none).
    """
    anomalies = []
    for sensor_key, value in sensor_data.items():
        # Only check sensors we have thresholds for
        if sensor_key in THRESHOLDS:
            rule = THRESHOLDS[sensor_key]
            min_val = rule.get("min")
            max_val = rule.get("max")

            # Skip None values
            if value is None:
                continue

            # Be resilient to string values by trying to coerce to float
            try:
                numeric_value = float(value)
            except Exception:
                # If value cannot be converted, treat it as non-anomalous but log
                print(f"Warning: non-numeric value for {sensor_key}: {value}")
                continue

            if min_val is not None and numeric_value < min_val:
                anomalies.append(sensor_key)
                continue
            if max_val is not None and numeric_value > max_val:
                anomalies.append(sensor_key)
                continue

    return anomalies

# --- Main Processing Loop ---
print("Starting to process existing documents...")
# Find all documents that DO NOT have the 'anomaly' field
query = {"anomaly": {"$exists": False}}
batch_size = 500
documents_processed = 0

try:
    while True:
        # Fetch a batch of untagged documents
        print(f"Fetching batch of {batch_size} untagged documents...")
        cursor = readings_collection.find(query).limit(batch_size)
        documents = list(cursor)
        
        if not documents:
            print("No more untagged documents found.")
            break
        
        print(f"Found {len(documents)} documents to process...")
        
        # Prepare bulk update operations
        bulk_operations = []
        for doc in documents:
            sensor_data = doc.get("sensorData", {})
            anomalies = check_for_anomaly(sensor_data)

            # Store both an anomalies array and a boolean 'anomaly' for compatibility
            update_fields = {
                "anomalies": anomalies,
                "anomaly": 1 if (anomalies and len(anomalies) > 0) else 0
            }

            # Create an operation to set the anomaly fields for this doc
            bulk_operations.append(
                pymongo.UpdateOne(
                    {"_id": doc["_id"]}, # Find document by its unique _id
                    {"$set": update_fields}
                )
            )
        
        # Execute the bulk update
        if bulk_operations:
            print(f"Updating {len(bulk_operations)} documents in the database...")
            result = readings_collection.bulk_write(bulk_operations)
            documents_processed += result.modified_count
            print(f"Updated {result.modified_count} documents.")
            
        # If this batch was less than the limit, we're done
        if len(documents) < batch_size:
            print("Finished processing all batches.")
            break
            
except Exception as e:
    print(f"An error occurred during processing: {e}")

finally:
    print(f"Total documents processed and tagged: {documents_processed}")
    client.close()
    print("MongoDB connection closed.")