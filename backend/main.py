# File: backend/main.py

from fastapi import FastAPI, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import motor.motor_asyncio
import uvicorn
from functools import lru_cache
import os # For constructing absolute paths

# --- Pydantic Settings ---
class Settings(BaseSettings):
    DATABASE_URL: str
    DB_NAME: str = "sensorDB"
    class Config: env_file = ".env"

@lru_cache()
def get_settings(): return Settings()
settings = get_settings()

# --- App Configuration ---
app = FastAPI( title="Sensor Data Viewer API", version="2.0.0" )

# --- CORS Middleware ---
origins = [ "http://localhost:3000", "http://localhost:5173", ]
app.add_middleware( CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"], )

# --- Database Connection ---
client = motor.motor_asyncio.AsyncIOMotorClient(settings.DATABASE_URL)
db = client[settings.DB_NAME]
readings_collection = db["sensorReadings"]

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

# Models have been removed from this deployment. Anomaly data (if present)
# should be stored alongside sensor readings in the database under the
# `anomaly` field (0 or 1). The endpoints below will return anomaly values
# when present. This keeps the backend lightweight and avoids ML runtime
# dependencies in environments where models are not available.


# --- API Endpoints ---
@app.get("/")
def read_root(): return {"message": "Welcome"}

@app.get("/api/debug/timestamp")
async def debug_timestamp():
    """Debug endpoint to check timestamp handling"""
    latest_doc = await readings_collection.find_one({"sensorData.pH": {"$exists": True}}, projection={"timestamp": 1}, sort=[("timestamp", -1)])
    if not latest_doc:
        return {"error": "No documents found"}
    
    ts = latest_doc["timestamp"]
    ts_type = type(ts).__name__
    
    # Parse the timestamp
    if isinstance(ts, str):
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    else:
        parsed = ts
    
    start_time = parsed - timedelta(days=1)
    
    # For string timestamps, we need to compare as strings in ISO format
    # MongoDB will compare ISO strings lexicographically which works for dates
    start_str = start_time.strftime("%Y-%m-%dT%H:%M:%S")
    end_str = parsed.strftime("%Y-%m-%dT%H:%M:%S") if isinstance(parsed, datetime) else str(parsed)[:19]
    
    # Test the query with string comparison
    count = await readings_collection.count_documents({
        "sensorData.pH": {"$exists": True, "$ne": None},
        "timestamp": {"$gte": start_str, "$lte": ts}
    })
    
    return {
        "raw_timestamp": str(ts),
        "timestamp_type": ts_type,
        "parsed": str(parsed),
        "start_time": str(start_time),
        "start_str": start_str,
        "end_str": end_str,
        "matching_docs": count
    }

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

# --- THIS IS THE FIXED FUNCTION (SIMPLIFIED) ---
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
    
    # --- THIS IS THE FIX ---
    # Check if the start/end times are actual datetime objects.
    # When called from /anomalies, they will be None.
    # When called from HTTP with no params, they will also be None.
    # When called from Reports.js, they will be datetime objects.
    # NOTE: Timestamps are stored as ISO strings, so we convert datetime to string for comparison
    
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
        # 'all' adds no time filter
    # --- END OF FIX ---

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

# --- THIS IS THE OTHER FIXED FUNCTION ---
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

# --- Uvicorn Server Runner ---
if __name__ == "__main__":
    print("Starting FastAPI server")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)