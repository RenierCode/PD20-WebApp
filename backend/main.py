from fastapi import FastAPI, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings # For loading .env
from typing import List, Optional, Dict, Any # Import Any
from datetime import datetime, timedelta
import motor.motor_asyncio
import uvicorn
from functools import lru_cache
import random # Import random for the dummy model

# --- Pydantic Settings ---
class Settings(BaseSettings):
    DATABASE_URL: str 
    DB_NAME: str = "sensorDB"

    class Config:
        env_file = ".env"

@lru_cache()
def get_settings():
    return Settings()

settings = get_settings()

# --- App Configuration ---
app = FastAPI(
    title="Sensor Data Viewer API",
    description="Backend for viewing sensor data from MongoDB.",
    version="2.0.0"
)

# --- CORS Middleware ---
origins = [
    "http://localhost:3000",
    "http://localhost:5173", # Default for Vite (React)
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Connection ---
client = motor.motor_asyncio.AsyncIOMotorClient(settings.DATABASE_URL)
db = client[settings.DB_NAME] 
nodes_collection = db["nodes"]
readings_collection = db["sensorReadings"]

# --- Pydantic Models ---
class Node(BaseModel):
    nodeId: str
    sensors: List[str]
    status: str
    lastSeen: Optional[datetime] = None

class SensorReading(BaseModel):
    nodeId: str
    timestamp: datetime
    sensorData: Dict[str, float]


# --- API Endpoints ---

@app.get("/")
def read_root():
    return {"message": "Welcome to the Sensor Data API"}

@app.get("/api/nodes", response_model=List[Node])
async def get_all_nodes_with_status():
    """
    Fetches all nodes and calculates their status.
    """
    pipeline = [
        {
            "$lookup": {
                "from": "sensorReadings",
                "localField": "_id",
                "foreignField": "nodeId",
                "as": "readings"
            }
        },
        { "$unwind": { "path": "$readings", "preserveNullAndEmptyArrays": True } },
        {
            "$group": {
                "_id": "$_id",
                "sensors": { "$first": "$sensors" },
                "lastSeen": { "$max": "$readings.timestamp" }
            }
        },
        { "$sort": { "_id": 1 } },
        {
            "$project": {
                "_id": 0,
                "nodeId": "$_id",
                "sensors": 1,
                "lastSeen": 1,
                "status": {
                    "$cond": {
                        "if": {
                            "$gte": ["$lastSeen", datetime.utcnow() - timedelta(days=1)]
                        },
                        "then": "Active",
                        "else": "Inactive"
                    }
                }
            }
        }
    ]
    
    nodes_cursor = nodes_collection.aggregate(pipeline)
    nodes_list = await nodes_cursor.to_list(100)
    return nodes_list

@app.get("/api/nodes/{node_id}/readings", response_model=List[SensorReading])
async def get_node_readings(
    node_id: str,
    range: str = Query("latest24h", enum=["latest24h", "24h", "1w", "1m", "all"]),
    sensor: str = Query(None)
):
    """
    Fetches time-series sensor readings for a specific node.
    - 'latest24h': 24h from the node's *latest* data point.
    - '24h', '1w', '1m': Ranges relative to *right now* (utcnow).
    - 'all': All data for the node.
    """
    
    # 1. Check if node exists
    node_exists = await nodes_collection.find_one({"_id": node_id})
    if not node_exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Node with ID '{node_id}' not found")
    
    # 2. Build the database filter
    filter_query = {"nodeId": node_id}
    
    if range == "latest24h":
        latest_doc = await readings_collection.find_one(
            {"nodeId": node_id}, projection={"timestamp": 1}, sort=[("timestamp", -1)]
        )
        if not latest_doc: return []
        latest_time = latest_doc["timestamp"]
        start_time = latest_time - timedelta(days=1)
        filter_query["timestamp"] = {"$gte": start_time, "$lte": latest_time}
    elif range == "24h":
        start_time = datetime.utcnow() - timedelta(days=1)
        filter_query["timestamp"] = {"$gte": start_time}
    elif range == "1w":
        start_time = datetime.utcnow() - timedelta(days=7)
        filter_query["timestamp"] = {"$gte": start_time}
    elif range == "1m":
        start_time = datetime.utcnow() - timedelta(days=30)
        filter_query["timestamp"] = {"$gte": start_time}
    elif range == "all":
        pass 
    
    # 3. Build the database projection
    projection = {"timestamp": 1, "_id": 0, "nodeId": 1}
    if sensor:
        projection[f"sensorData.{sensor}"] = 1
    else:
        projection["sensorData"] = 1
        
    # 4. Fetch data
    readings_cursor = readings_collection.find(filter_query, projection).sort("timestamp", 1)
    readings = await readings_cursor.to_list(2000)
    
    # 5. Post-process the data
    processed_readings = []
    for r in readings:
        sensor_data = r.get("sensorData", {})
        if sensor:
             sensor_data = { sensor: sensor_data.get(sensor) }

        processed_readings.append({
            "nodeId": node_id,
            "timestamp": r["timestamp"],
            "sensorData": sensor_data
        })
    return processed_readings


# --- ENDPOINT FOR SUMMARY GRAPH ---
@app.get("/api/data/sensor/{sensor_name}", response_model=List[Dict[str, Any]])
async def get_data_for_sensor(
    sensor_name: str,
    range: str = Query("latest24h", enum=["latest24h", "24h", "1w", "1m", "all"])
):
    """
    Fetches data for a *single sensor* across *all nodes* and
    formats it for the summary graph.
    """
    
    # 1. Determine time range filter
    match_stage = {
        f"sensorData.{sensor_name}": {"$exists": True}
    }
    
    if range == "latest24h":
        latest_doc = await readings_collection.find_one(
            {f"sensorData.{sensor_name}": {"$exists": True}},
            projection={"timestamp": 1},
            sort=[("timestamp", -1)]
        )
        if not latest_doc: return []
        latest_time = latest_doc["timestamp"]
        start_time = latest_time - timedelta(days=1)
        match_stage["timestamp"] = {"$gte": start_time, "$lte": latest_time}
    elif range == "24h":
        start_time = datetime.utcnow() - timedelta(days=1)
        match_stage["timestamp"] = {"$gte": start_time}
    elif range == "1w":
        start_time = datetime.utcnow() - timedelta(days=7)
        match_stage["timestamp"] = {"$gte": start_time}
    elif range == "1m":
        start_time = datetime.utcnow() - timedelta(days=30)
        match_stage["timestamp"] = {"$gte": start_time}
    
    pipeline = [
        { "$match": match_stage },
        {
            "$group": {
                "_id": "$timestamp",
                "readings": {
                    "$push": {
                        "node": "$nodeId",
                        "value": f"$sensorData.{sensor_name}"
                    }
                }
            }
        },
        {
            "$addFields": {
                "nodesData": {
                    "$arrayToObject": {
                        "$map": {
                            "input": "$readings",
                            "as": "reading",
                            "in": { "k": "$$reading.node", "v": "$$reading.value" }
                        }
                    }
                }
            }
        },
        {
            "$replaceRoot": {
                "newRoot": {
                    "$mergeObjects": [ "$nodesData", { "timestamp": "$_id" } ]
                }
            }
        },
        { "$sort": { "timestamp": 1 } }
    ]
    
    cursor = readings_collection.aggregate(pipeline)
    data = await cursor.to_list(2000)
    return data


# --- DUMMY MODEL FUNCTION (REPLACE THIS) ---
def detect_anomalies_with_dl(readings: List[SensorReading], sensor_key: str) -> List[SensorReading]:
    """
    This is a placeholder for your real deep learning model.
    It just randomly flags ~10% of data points as anomalies.
    
    REPLACE THIS FUNCTION with your model's prediction logic.
    """
    anomalies = []
    if not readings:
        return []
        
    for r in readings:
        if random.random() < 0.1:
            anomalies.append(r)
            
    return anomalies


# --- NEW ENDPOINT: /api/nodes/{node_id}/anomalies ---
@app.get("/api/nodes/{node_id}/anomalies", response_model=List[Dict[str, Any]])
async def get_node_anomalies(
    node_id: str,
    sensor: str = Query(...), # Sensor is required for anomaly detection
    range: str = Query("latest24h", enum=["latest24h", "24h", "1w", "1m", "all"])
):
    """
    Runs anomaly detection on a specific sensor's data for a node
    and returns ONLY the anomaly points.
    """
    
    # 1. Fetch the raw data
    raw_readings_data = await get_node_readings(node_id=node_id, range=range, sensor=sensor)
    
    # 2. Convert raw dicts back to Pydantic models for the dummy function
    readings_list = [SensorReading(**r) for r in raw_readings_data]

    # 3. Run the "model"
    anomaly_readings = detect_anomalies_with_dl(readings_list, sensor)
    
    # 4. Format the response to be simple {timestamp, value} pairs
    results = []
    for r in anomaly_readings:
        if sensor in r.sensorData:
            results.append({
                "timestamp": r.timestamp,
                "value": r.sensorData[sensor]
            })
            
    return results


# --- Uvicorn Server Runner ---
if __name__ == "__main__":
    print("Starting FastAPI server at http://127.0.0.1:8000")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)