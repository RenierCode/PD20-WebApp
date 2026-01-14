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
nodes_collection = db["nodes"]
readings_collection = db["sensorReadings"]

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

@app.get("/api/nodes", response_model=List[Node])
async def get_all_nodes_with_status():
    pipeline = [ {"$lookup": {"from": "sensorReadings", "localField": "_id", "foreignField": "nodeId", "as": "readings"}}, {"$unwind": {"path": "$readings", "preserveNullAndEmptyArrays": True}}, {"$group": {"_id": "$_id", "sensors": {"$first": "$sensors"}, "lastSeen": {"$max": "$readings.timestamp"}}}, {"$sort": {"_id": 1}}, {"$project": {"_id": 0, "nodeId": "$_id", "sensors": 1, "lastSeen": 1, "status": {"$cond": {"if": {"$gte": ["$lastSeen", datetime.utcnow() - timedelta(days=1)]}, "then": "Active", "else": "Inactive"}}}} ]
    nodes_cursor = nodes_collection.aggregate(pipeline)
    return await nodes_cursor.to_list(100)

# --- THIS IS THE FIXED FUNCTION (SIMPLIFIED) ---
@app.get("/api/nodes/{node_id}/readings", response_model=List[SensorReading])
async def get_node_readings(
    node_id: str,
    range: str = Query("latest24h", enum=["latest24h", "24h", "1w", "1m", "all"]),
    sensor: Optional[str] = Query(None),
    start_time: Optional[datetime] = Query(None),
    end_time: Optional[datetime] = Query(None)
):
    
    node_exists = await nodes_collection.find_one({"_id": node_id})
    if not node_exists: raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    
    filter_query = {"nodeId": node_id}
    
    # --- THIS IS THE FIX ---
    # Check if the start/end times are actual datetime objects.
    # When called from /anomalies, they will be None.
    # When called from HTTP with no params, they will also be None.
    # When called from Reports.js, they will be datetime objects.
    
    if isinstance(start_time, datetime) and isinstance(end_time, datetime):
        filter_query["timestamp"] = {"$gte": start_time, "$lte": end_time}
    elif isinstance(start_time, datetime):
        filter_query["timestamp"] = {"$gte": start_time}
    elif isinstance(end_time, datetime):
        filter_query["timestamp"] = {"$lte": end_time}
    
    # Fallback to relative 'range' if no specific times are given
    else:
        if range == "latest24h":
            latest_doc = await readings_collection.find_one({"nodeId": node_id}, projection={"timestamp": 1}, sort=[("timestamp", -1)])
            if not latest_doc: return []
            latest_time, start_time_calc = latest_doc["timestamp"], latest_doc["timestamp"] - timedelta(days=1)
            filter_query["timestamp"] = {"$gte": start_time_calc, "$lte": latest_time}
        elif range == "24h": filter_query["timestamp"] = {"$gte": datetime.utcnow() - timedelta(days=1)}
        elif range == "1w": filter_query["timestamp"] = {"$gte": datetime.utcnow() - timedelta(days=7)}
        elif range == "1m": filter_query["timestamp"] = {"$gte": datetime.utcnow() - timedelta(days=30)}
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
async def get_data_for_sensor( sensor_name: str, range: str = Query("latest24h", enum=["latest24h", "24h", "1w", "1m", "all"]) ):
    match_stage = {f"sensorData.{sensor_name}": {"$exists": True, "$ne": None}}
    if range == "latest24h":
        latest_doc = await readings_collection.find_one({f"sensorData.{sensor_name}": {"$exists": True, "$ne": None}}, projection={"timestamp": 1}, sort=[("timestamp", -1)])
        if not latest_doc: return []
        latest_time, start_time = latest_doc["timestamp"], latest_doc["timestamp"] - timedelta(days=1)
        match_stage["timestamp"] = {"$gte": start_time, "$lte": latest_time}
    elif range == "24h": match_stage["timestamp"] = {"$gte": datetime.utcnow() - timedelta(days=1)}
    elif range == "1w": match_stage["timestamp"] = {"$gte": datetime.utcnow() - timedelta(days=7)}
    elif range == "1m": match_stage["timestamp"] = {"$gte": datetime.utcnow() - timedelta(days=30)}
    pipeline = [ {"$match": match_stage}, {"$group": {"_id": "$timestamp", "readings": {"$push": {"node": "$nodeId", "value": f"$sensorData.{sensor_name}"}}}}, {"$addFields": {"nodesData": {"$arrayToObject": {"$map": {"input": "$readings", "as": "reading", "in": {"k": "$$reading.node", "v": "$$reading.value"}}}}}}, {"$replaceRoot": {"newRoot": {"$mergeObjects": ["$nodesData", {"timestamp": "$_id"}]}}}, {"$sort": {"timestamp": 1}} ]
    cursor = readings_collection.aggregate(pipeline)
    return await cursor.to_list(2000)

# --- THIS IS THE OTHER FIXED FUNCTION ---
@app.get("/api/nodes/{node_id}/anomalies", response_model=List[Dict[str, Any]])
async def get_node_anomalies(
    node_id: str,
    sensor: str = Query(...), 
    range: str = Query("latest24h", enum=["latest24h", "24h", "1w", "1m", "all"])
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
        end_time=None
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
        node_exists = await nodes_collection.find_one({"_id": node_id})
        if not node_exists: raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
        return NodeTimeRange(nodeId=node_id, firstSeen=None, lastSeen=None)
    return NodeTimeRange( nodeId=node_id, firstSeen=first_reading["timestamp"], lastSeen=last_reading["timestamp"] )

# --- Uvicorn Server Runner ---
if __name__ == "__main__":
    print("Starting FastAPI server")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)