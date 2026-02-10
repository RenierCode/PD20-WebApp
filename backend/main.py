# main.py - FastAPI Backend Server
# See DOCS.md in project root for full documentation

from fastapi import FastAPI, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone
import motor.motor_asyncio
import uvicorn
from functools import lru_cache
import os
from pathlib import Path
import asyncio
import warnings

# Suppress sklearn warnings
warnings.filterwarnings("ignore", category=UserWarning)

# Import shared config (model paths and threshold rules)
from config import MODELS_DIR, SENSOR_MODEL_MAP, THRESHOLDS

# =============================================================================
# APPLICATION SETTINGS
# =============================================================================

class Settings(BaseSettings):
    """
    Application settings loaded from environment variables (.env file).
    
    DATABASE_URL: MongoDB Atlas connection string
    DB_NAME: Database name (default: sensorDB)
    AUTO_DETECT_THRESHOLD: Number of untagged readings that triggers auto-detection
    """
    DATABASE_URL: str
    DB_NAME: str = "sensorDB"
    AUTO_DETECT_THRESHOLD: int = 100
    class Config: env_file = ".env"

# Cache settings to avoid re-reading .env file on every request
@lru_cache()
def get_settings(): return Settings()
settings = get_settings()

# =============================================================================
# FASTAPI APP SETUP
# =============================================================================

app = FastAPI( title="Sensor Data Viewer API", version="2.0.0" )

# CORS Middleware: Allow frontend apps on these origins to make API requests
origins = [ "http://localhost:3000", "http://localhost:5173", ]
app.add_middleware( CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"], )

# =============================================================================
# DATABASE CONNECTION
# =============================================================================

# Motor is an async MongoDB driver - essential for FastAPI's async endpoints
client = motor.motor_asyncio.AsyncIOMotorClient(settings.DATABASE_URL)
db = client[settings.DB_NAME]
readings_collection = db["sensorReadings"]  # Main collection storing all sensor data

# =============================================================================
# ANOMALY DETECTION ENGINE
# =============================================================================
# This section handles ML-based anomaly detection using Isolation Forest models.
# The system can detect unusual sensor readings that may indicate:
#   - Sensor malfunction
#   - Water quality issues (contamination, pH imbalance)
#   - System failures (pump issues, leaks)

# Global state for model management
_loaded_models: Dict[str, Any] = {}  # Cached loaded models {sensor_name: model}
_models_loaded: bool = False          # Flag to prevent reloading models
_detection_running: bool = False      # Prevents concurrent detection runs

def load_models() -> Dict[str, Any]:
    """
    Load Isolation Forest models from disk into memory.
    
    Models are loaded once and cached globally for performance.
    Each model is trained to detect anomalies for a specific sensor type.
    
    Returns:
        Dict mapping sensor names to their loaded sklearn models
    """
    global _loaded_models, _models_loaded
    
    if _models_loaded:
        return _loaded_models
    
    try:
        import joblib
    except ImportError:
        print("Warning: joblib not installed. Using threshold-based detection.")
        _models_loaded = True
        return {}
    
    for sensor, filename in SENSOR_MODEL_MAP.items():
        model_path = MODELS_DIR / filename
        if model_path.exists() and sensor not in _loaded_models:
            try:
                _loaded_models[sensor] = joblib.load(model_path)
                print(f"  [OK] Loaded model for '{sensor}'")
            except Exception as e:
                print(f"  [FAIL] Failed to load model for '{sensor}': {e}")
    
    _models_loaded = True
    print(f"Loaded {len(set(_loaded_models.values()))} unique ML models")
    return _loaded_models

def check_anomaly_ml(sensor_key: str, value: float, models: Dict) -> bool:
    """
    Check if a sensor value is anomalous using its Isolation Forest model.
    
    Isolation Forest works by isolating observations - anomalies are easier
    to isolate and thus have shorter average path lengths in the trees.
    
    Args:
        sensor_key: Name of the sensor (e.g., "temperature", "pH")
        value: The sensor reading to check
        models: Dict of loaded models
        
    Returns:
        True if the value is anomalous, False otherwise
    """
    model = models.get(sensor_key)
    if model is None:
        return False
    try:
        # Isolation Forest returns -1 for anomalies, 1 for normal points
        prediction = model.predict([[float(value)]])
        return prediction[0] == -1
    except:
        return False

def check_anomaly_threshold(sensor_key: str, value: float) -> bool:
    """
    Check if a sensor value is outside acceptable thresholds.
    
    This is a simple rule-based fallback when ML models aren't available.
    A value is anomalous if it's below the minimum or above the maximum.
    
    Args:
        sensor_key: Name of the sensor
        value: The sensor reading to check
        
    Returns:
        True if value is outside threshold bounds
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

def check_for_anomalies(sensor_data: Dict, models: Dict = None, use_threshold: bool = False) -> List[str]:
    """
    Check all sensors in a single reading for anomalies.
    
    For each sensor value in the reading:
      1. If use_threshold=True, only check against thresholds
      2. Otherwise, try ML model first, fall back to threshold if no model
    
    Args:
        sensor_data: Dict of sensor readings {"pH": 7.2, "temperature": 25.5, ...}
        models: Loaded ML models (optional)
        use_threshold: If True, skip ML and only use threshold rules
        
    Returns:
        List of sensor names that were flagged as anomalous
    """
    # Sensors with broken ML models - always use threshold detection for these
    BROKEN_ML_SENSORS = {"flowRate", "flow_rate"}
    
    anomalies = []
    for sensor_key, value in sensor_data.items():
        if value is None:
            continue
        if use_threshold or sensor_key in BROKEN_ML_SENSORS:
            # Use threshold-based detection
            is_anomaly = check_anomaly_threshold(sensor_key, value)
        else:
            # Try ML model first
            is_anomaly = check_anomaly_ml(sensor_key, value, models or {})
            # Fall back to threshold if no model exists for this sensor
            if not is_anomaly and (models is None or models.get(sensor_key) is None):
                is_anomaly = check_anomaly_threshold(sensor_key, value)
        if is_anomaly:
            anomalies.append(sensor_key)
    return anomalies

async def process_anomalies_batch(
    reprocess_all: bool = False,
    node_id: Optional[str] = None,
    use_threshold: bool = False,
    batch_size: int = 500
) -> Dict[str, Any]:
    """
    Process anomaly detection on multiple sensor readings in batches.
    
    This is the main detection function used by both:
      - Manual detection (triggered via API)
      - Auto-detection (background task)
    
    Args:
        reprocess_all: If True, reprocess all data. If False, only unprocessed.
        node_id: Optional filter to process only one node's data
        use_threshold: If True, use threshold rules instead of ML models
        batch_size: Number of documents to process at once (memory/speed tradeoff)
        
    Returns:
        Dict with success status, message, count processed, anomalies found
    """
    global _detection_running
    
    if _detection_running:
        return {"success": False, "message": "Detection already running", "processed": 0, "anomalies_found": 0}
    
    _detection_running = True
    
    try:
        # Load models if using ML
        models = {} if use_threshold else load_models()
        if not models and not use_threshold:
            use_threshold = True  # Fallback to threshold if no models
        
        # Build query
        query = {}
        if node_id:
            query["nodeId"] = node_id
        if not reprocess_all:
            query["anomaly"] = {"$exists": False}
        
        total_count = await readings_collection.count_documents(query)
        
        if total_count == 0:
            return {"success": True, "message": "No unprocessed readings", "processed": 0, "anomalies_found": 0}
        
        processed = 0
        anomalies_found = 0
        
        # Process in batches using cursor
        cursor = readings_collection.find(query).batch_size(batch_size)
        
        batch = []
        async for doc in cursor:
            sensor_data = doc.get("sensorData", {})
            anomalies = check_for_anomalies(sensor_data, models, use_threshold)
            
            batch.append({
                "_id": doc["_id"],
                "anomalies": anomalies,
                "anomaly": 1 if anomalies else 0
            })
            
            if anomalies:
                anomalies_found += 1
            
            # Write batch when full
            if len(batch) >= batch_size:
                await _write_anomaly_batch(batch)
                processed += len(batch)
                batch = []
        
        # Write remaining
        if batch:
            await _write_anomaly_batch(batch)
            processed += len(batch)
        
        return {
            "success": True,
            "message": f"Processed {processed} readings" + (" (threshold mode)" if use_threshold else " (ML mode)"),
            "processed": processed,
            "anomalies_found": anomalies_found
        }
    
    finally:
        _detection_running = False

async def _write_anomaly_batch(batch: List[Dict]):
    """Write a batch of anomaly updates to the database."""
    from pymongo import UpdateOne
    
    operations = [
        UpdateOne(
            {"_id": item["_id"]},
            {"$set": {
                "anomalies": item["anomalies"],
                "anomaly": item["anomaly"],
                "anomaly_processed_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        for item in batch
    ]
    
    if operations:
        await readings_collection.bulk_write(operations)

async def auto_detect_anomalies():
    """Background task to auto-detect anomalies when threshold is reached."""
    while True:
        try:
            unprocessed = await readings_collection.count_documents({"anomaly": {"$exists": False}})
            
            if unprocessed >= settings.AUTO_DETECT_THRESHOLD:
                print(f"[Auto-detect] {unprocessed} untagged readings found, running detection...")
                result = await process_anomalies_batch(reprocess_all=False, use_threshold=False)
                print(f"[Auto-detect] {result['message']}")
            
            # Check every 30 seconds
            await asyncio.sleep(30)
        except Exception as e:
            print(f"[Auto-detect] Error: {e}")
            await asyncio.sleep(60)

@app.on_event("startup")
async def startup_event():
    """Load models and start background tasks on startup."""
    print("Loading anomaly detection models...")
    load_models()
    
    # Start auto-detection background task
    asyncio.create_task(auto_detect_anomalies())
    print(f"Auto-detection enabled (threshold: {settings.AUTO_DETECT_THRESHOLD} readings)")

# =============================================================================

# --- Helper function for timestamp handling ---
def parse_timestamp(ts):
    """Parse timestamp from string or datetime, return datetime object"""
    if isinstance(ts, str):
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return ts

def get_time_range_filter(latest_ts_raw, range_type: str, use_current_time: bool = False):
    """
    Given the raw latest timestamp and a range type, return a MongoDB filter dict.
    Handles both string and datetime timestamps in the database.
    
    Args:
        latest_ts_raw: The latest timestamp from the database (for end bound and format detection)
        range_type: One of '10m', '30m', '1h', '6h', '24h', '7d'
        use_current_time: If True, calculate start time from current time (for "Now" options)
    """
    latest_dt = parse_timestamp(latest_ts_raw)
    is_string_timestamp = isinstance(latest_ts_raw, str)
    
    # Determine the reference time for calculating the start
    if use_current_time:
        # Use current UTC time for "Now" based ranges
        ref_time = datetime.utcnow()
    else:
        # Use latest data timestamp for "Data" based ranges
        ref_time = latest_dt
        if hasattr(ref_time, 'tzinfo') and ref_time.tzinfo is not None:
            ref_time = ref_time.replace(tzinfo=None)
    
    # Calculate start time based on range
    if range_type == "10m":
        start_dt = ref_time - timedelta(minutes=10)
    elif range_type == "30m":
        start_dt = ref_time - timedelta(minutes=30)
    elif range_type == "1h":
        start_dt = ref_time - timedelta(hours=1)
    elif range_type == "6h":
        start_dt = ref_time - timedelta(hours=6)
    elif range_type == "24h":
        start_dt = ref_time - timedelta(days=1)
    elif range_type == "7d":
        start_dt = ref_time - timedelta(days=7)
    else:
        # Default to 10 minutes
        start_dt = ref_time - timedelta(minutes=10)
    
    # Build the filter - for string timestamps, use string comparison
    if is_string_timestamp:
        start_str = start_dt.strftime("%Y-%m-%dT%H:%M:%S")
        if use_current_time:
            # For "Now" ranges, use current time as end bound
            end_str = ref_time.strftime("%Y-%m-%dT%H:%M:%S.999999Z")
            return {"$gte": start_str, "$lte": end_str}
        else:
            return {"$gte": start_str, "$lte": latest_ts_raw}
    else:
        if use_current_time:
            return {"$gte": start_dt, "$lte": ref_time}
        else:
            return {"$gte": start_dt, "$lte": latest_dt}

# --- Pydantic Models ---
class Node(BaseModel):
    nodeId: str; sensors: List[str]; status: str; lastSeen: Optional[datetime] = None
class SensorReading(BaseModel):
    nodeId: str
    timestamp: datetime
    sensorData: Dict[str, float]
    anomaly: Optional[int] = 0
    anomalies: Optional[List[str]] = None
class NodeTimeRange(BaseModel):
    nodeId: str
    firstSeen: Optional[datetime] = None
    lastSeen: Optional[datetime] = None




# --- API Endpoints ---
@app.get("/")
def read_root(): return {"message": "Welcome"}

@app.get("/api/nodes", response_model=List[Node])
async def get_all_nodes_with_status():
    """
    Get all nodes by aggregating unique nodeId values from sensorReadings.
    This removes the need for a separate 'nodes' collection.
    """
    pipeline = [
        # Group by nodeId to find unique nodes
        {
            "$group": {
                "_id": "$nodeId",
                # Collect all sensor keys from each reading's sensorData
                "allSensorArrays": {"$push": {"$objectToArray": "$sensorData"}},
                "lastSeen": {"$max": "$timestamp"}
            }
        },
        # Flatten the array of arrays and extract unique sensor keys
        {
            "$addFields": {
                "sensors": {
                    "$setUnion": {
                        "$map": {
                            "input": {
                                "$reduce": {
                                    "input": "$allSensorArrays",
                                    "initialValue": [],
                                    "in": {"$concatArrays": ["$$value", "$$this"]}
                                }
                            },
                            "as": "item",
                            "in": "$$item.k"
                        }
                    }
                }
            }
        },
        {"$sort": {"_id": 1}},
        {
            "$project": {
                "_id": 0,
                "nodeId": "$_id",
                "sensors": 1,
                "lastSeen": 1,
                "status": {
                    "$cond": {
                        "if": {"$gte": ["$lastSeen", datetime.utcnow() - timedelta(days=1)]},
                        "then": "Active",
                        "else": "Inactive"
                    }
                }
            }
        }
    ]
    nodes_cursor = readings_collection.aggregate(pipeline)
    return await nodes_cursor.to_list(100)

@app.get("/api/nodes/{node_id}/readings", response_model=List[SensorReading])
async def get_node_readings(
    node_id: str,
    range: str = Query("10m", enum=["10m", "30m", "1h", "6h", "24h", "7d", "all"]),
    sensor: Optional[str] = Query(None),
    start_time: Optional[datetime] = Query(None),
    end_time: Optional[datetime] = Query(None),
    fromNow: bool = Query(True, description="If True, range is relative to current time. If False, relative to latest data.")
):
    
    # Check if node exists by looking for any reading with this nodeId
    node_exists = await readings_collection.find_one({"nodeId": node_id})
    if not node_exists: raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    
    filter_query = {"nodeId": node_id}
    
    # Handle explicit start/end times (convert to ISO strings for MongoDB comparison)
    if isinstance(start_time, datetime) and isinstance(end_time, datetime):
        start_str = start_time.strftime("%Y-%m-%dT%H:%M:%S")
        end_str = end_time.strftime("%Y-%m-%dT%H:%M:%S.999999Z")
        filter_query["timestamp"] = {"$gte": start_str, "$lte": end_str}
    elif isinstance(start_time, datetime):
        start_str = start_time.strftime("%Y-%m-%dT%H:%M:%S")
        filter_query["timestamp"] = {"$gte": start_str}
    elif isinstance(end_time, datetime):
        end_str = end_time.strftime("%Y-%m-%dT%H:%M:%S.999999Z")
        filter_query["timestamp"] = {"$lte": end_str}
    
    # Fallback to relative 'range' if no specific times are given
    else:
        # For all time-based ranges, first get the latest timestamp from the data
        if range != "all":
            latest_doc = await readings_collection.find_one({"nodeId": node_id}, projection={"timestamp": 1}, sort=[("timestamp", -1)])
            if not latest_doc: return []
            # fromNow=True uses current time, fromNow=False uses latest data timestamp
            filter_query["timestamp"] = get_time_range_filter(latest_doc["timestamp"], range, use_current_time=fromNow)

    projection = {"timestamp": 1, "_id": 0, "nodeId": 1, "anomaly": 1, "anomalies": 1}
    if sensor: projection[f"sensorData.{sensor}"] = 1
    else: projection["sensorData"] = 1
    
    readings_cursor = readings_collection.find(filter_query, projection).sort("timestamp", 1)
    readings = await readings_cursor.to_list(2000)
    
    processed_readings = []
    for r in readings:
        sensor_data = r.get("sensorData", {}); 
        sd = {sensor: sensor_data.get(sensor)} if sensor else sensor_data
        
        if sensor and sensor not in sd: continue
        if sensor and sd.get(sensor) is None: continue
        if not sd: continue
        
        processed_readings.append(SensorReading(nodeId=node_id, timestamp=r["timestamp"], sensorData=sd, anomaly=r.get("anomaly", 0), anomalies=r.get("anomalies")))
    return processed_readings


@app.get("/api/data/sensor/{sensor_name}", response_model=List[Dict[str, Any]])
async def get_data_for_sensor( 
    sensor_name: str, 
    range: str = Query("24h", enum=["10m", "30m", "1h", "6h", "24h", "7d", "all"]),
    fromNow: bool = Query(True, description="If True, range is relative to current time. If False, relative to latest data.")
):
    match_stage = {f"sensorData.{sensor_name}": {"$exists": True, "$ne": None}}
    
    # For all time-based ranges, use the latest data timestamp as reference
    if range != "all":
        latest_doc = await readings_collection.find_one({f"sensorData.{sensor_name}": {"$exists": True, "$ne": None}}, projection={"timestamp": 1}, sort=[("timestamp", -1)])
        if not latest_doc: return []
        # fromNow=True uses current time, fromNow=False uses latest data timestamp
        match_stage["timestamp"] = get_time_range_filter(latest_doc["timestamp"], range, use_current_time=fromNow)
    
    pipeline = [ {"$match": match_stage}, {"$group": {"_id": "$timestamp", "readings": {"$push": {"node": "$nodeId", "value": f"$sensorData.{sensor_name}"}}}}, {"$addFields": {"nodesData": {"$arrayToObject": {"$map": {"input": "$readings", "as": "reading", "in": {"k": "$$reading.node", "v": "$$reading.value"}}}}}}, {"$replaceRoot": {"newRoot": {"$mergeObjects": ["$nodesData", {"timestamp": "$_id"}]}}}, {"$sort": {"timestamp": 1}} ]
    cursor = readings_collection.aggregate(pipeline)
    return await cursor.to_list(2000)

@app.get("/api/nodes/{node_id}/anomalies", response_model=List[Dict[str, Any]])
async def get_node_anomalies(
    node_id: str,
    sensor: str = Query(...), 
    range: str = Query("24h", enum=["10m", "30m", "1h", "6h", "24h", "7d", "all"]),
    fromNow: bool = Query(True)
):
    """Return anomaly points for a sensor using the stored `anomaly` flag on readings.
    This endpoint no longer runs ML models; it simply returns readings where
    the `anomaly` field is truthy and the sensor value exists.
    """
    readings_list = await get_node_readings(
        node_id=node_id,
        range=range,
        sensor=sensor,
        start_time=None,
        end_time=None,
        fromNow=fromNow
    )
    if not readings_list: return []

    # Prefer per-reading `anomalies` array when available (flags specific sensors), otherwise fall back to boolean `anomaly`.
    anomaly_readings = []
    for r in readings_list:
        if getattr(r, 'anomalies', None):
            if sensor in (r.anomalies or []):
                anomaly_readings.append(r)
        elif getattr(r, 'anomaly', 0):
            if sensor in r.sensorData:
                anomaly_readings.append(r)

    results = [{"timestamp": r.timestamp, "value": r.sensorData[sensor]} for r in anomaly_readings]
    return results

@app.get("/api/nodes/{node_id}/time_range", response_model=NodeTimeRange)
async def get_node_time_range(node_id: str):
    """ Fetches the very first (oldest) and very last (newest) timestamp for a given node. """
    first_reading = await readings_collection.find_one( {"nodeId": node_id}, projection={"timestamp": 1}, sort=[("timestamp", 1)] )
    last_reading = await readings_collection.find_one( {"nodeId": node_id}, projection={"timestamp": 1}, sort=[("timestamp", -1)] )
    if not first_reading:
        # Check if node exists by looking in sensorReadings (will be None if no readings)
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found or has no readings")
    return NodeTimeRange( nodeId=node_id, firstSeen=first_reading["timestamp"], lastSeen=last_reading["timestamp"] )


# --- Anomaly Detection Endpoints ---
class AnomalyDetectionResponse(BaseModel):
    success: bool
    message: str
    processed: Optional[int] = None
    anomalies_found: Optional[int] = None
    stats: Optional[Dict[str, Any]] = None

@app.post("/api/anomaly/detect", response_model=AnomalyDetectionResponse)
async def run_anomaly_detection(
    reprocess_all: bool = Query(False, description="Reprocess all data, not just new"),
    node_id: Optional[str] = Query(None, description="Process only a specific node"),
    use_threshold: bool = Query(False, description="Use threshold-based detection instead of ML")
):
    """
    Run anomaly detection on sensor readings.
    Uses Isolation Forest ML models by default, with threshold fallback.
    Detection runs directly in the backend - no subprocess needed.
    """
    result = await process_anomalies_batch(
        reprocess_all=reprocess_all,
        node_id=node_id,
        use_threshold=use_threshold
    )
    
    return AnomalyDetectionResponse(
        success=result["success"],
        message=result["message"],
        processed=result["processed"],
        anomalies_found=result["anomalies_found"]
    )

@app.get("/api/anomaly/status")
async def get_anomaly_status():
    """Get current anomaly detection status including unprocessed count."""
    total = await readings_collection.count_documents({})
    unprocessed = await readings_collection.count_documents({"anomaly": {"$exists": False}})
    processed = total - unprocessed
    with_anomalies = await readings_collection.count_documents({"anomaly": 1})
    
    return {
        "total_readings": total,
        "processed": processed,
        "unprocessed": unprocessed,
        "with_anomalies": with_anomalies,
        "detection_running": _detection_running,
        "auto_detect_threshold": settings.AUTO_DETECT_THRESHOLD,
        "will_auto_detect": unprocessed >= settings.AUTO_DETECT_THRESHOLD,
        "models_loaded": len(_loaded_models) > 0
    }


@app.get("/api/anomaly/stats")
async def get_anomaly_stats():
    """Get statistics about anomaly detection in the database."""
    total = await readings_collection.count_documents({})
    processed = await readings_collection.count_documents({"anomaly": {"$exists": True}})
    unprocessed = total - processed
    with_anomalies = await readings_collection.count_documents({"anomaly": 1})
    
    # Per-sensor breakdown
    pipeline = [
        {"$match": {"anomalies": {"$exists": True, "$ne": []}}},
        {"$unwind": "$anomalies"},
        {"$group": {"_id": "$anomalies", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    cursor = readings_collection.aggregate(pipeline)
    sensor_counts = await cursor.to_list(100)
    
    return {
        "total_readings": total,
        "processed": processed,
        "unprocessed": unprocessed,
        "processed_percent": round(processed / total * 100, 1) if total > 0 else 0,
        "with_anomalies": with_anomalies,
        "anomaly_rate": round(with_anomalies / processed * 100, 2) if processed > 0 else 0,
        "by_sensor": {item["_id"]: item["count"] for item in sensor_counts},
        "models_loaded": list(set(SENSOR_MODEL_MAP.keys()) & set(_loaded_models.keys()))
    }


# --- Uvicorn Server Runner ---
if __name__ == "__main__":
    print("Starting FastAPI server")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)