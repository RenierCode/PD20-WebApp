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
import numpy as np
import joblib # Using joblib for scikit-learn models
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
    nodeId: str; timestamp: datetime; sensorData: Dict[str, float]
class NodeTimeRange(BaseModel):
    nodeId: str
    firstSeen: Optional[datetime] = None
    lastSeen: Optional[datetime] = None

# --- Load Univariate Models & Scalers (using joblib) ---
# <<< ADJUST THIS DICTIONARY TO MATCH YOUR SENSOR NAMES AND MODEL FILES >>>
MODEL_CONFIG = {
    "temperature": {
        "model_path": "models/isolation_forest_model_temperature.pkl",
        # "scaler_path": "models/temperature_scaler.pkl", # Optional
    },
    "pH": {
        "model_path": "models/isolation_forest_model_pH_level.pkl",
        # "scaler_path": "models/ph_scaler.pkl",
    },
    "turbidity": {
        "model_path": "models/isolation_forest_model_turbidity.pkl",
        # "scaler_path": "models/turbidity_scaler.pkl",
    },
    "flowrate": {
        "model_path": "models/isolation_forest_model_flow_rate.pkl",
        # "scaler_path": "models/flow_rate_scaler.pkl",
    },
    "waterLevel": {
        "model_path": "models/isolation_forest_model_water_level.pkl",
        # "scaler_path": "models/water_level_scaler.pkl",
    },
    # Add entries for other sensors (tds, etc.) if you have models
}

loaded_models = {}
loaded_scalers = {} # Optional: Dictionary to hold loaded scalers

print("--- Loading Anomaly Models (using joblib) ---")
base_dir = os.path.dirname(os.path.abspath(__file__)) # Get directory of main.py

for key, config in MODEL_CONFIG.items():
    model_file_path = None; scaler_file_path = None
    try:
        # Construct absolute paths
        model_file = config["model_path"]
        model_file_path = os.path.join(base_dir, model_file)

        # Load the model using joblib
        if not os.path.exists(model_file_path):
             raise FileNotFoundError(f"Model file not found at {model_file_path}")
        loaded_models[key] = joblib.load(model_file_path) # <-- USE joblib.load()
        print(f"OK: Loaded model for '{key}' from {model_file_path}")

        # Optional: Load the scaler using joblib
        if "scaler_path" in config:
            scaler_file = config["scaler_path"]
            scaler_file_path = os.path.join(base_dir, scaler_file)
            if not os.path.exists(scaler_file_path):
                 raise FileNotFoundError(f"Scaler file not found at {scaler_file_path}")
            loaded_scalers[key] = joblib.load(scaler_file_path) # <-- USE joblib.load()
            print(f"OK: Loaded scaler for '{key}' from {scaler_file_path}")

    except FileNotFoundError as fnf_err:
        print(f"ERROR: {fnf_err}")
    except Exception as e:
        # This will catch version mismatch errors
        print(f"ERROR loading model/scaler for '{key}' using joblib: {e}")
print("--- Model Loading Complete ---")


# --- Anomaly Detection Function (Univariate) ---
def detect_anomalies_univariate(readings: List[SensorReading], sensor_key: str) -> List[SensorReading]:
    """ Uses the appropriate loaded univariate scikit-learn model. """
    anomalies = []
    if sensor_key not in loaded_models:
        print(f"Warning: No model loaded for sensor '{sensor_key}'.")
        return []
    model = loaded_models[sensor_key]
    scaler = loaded_scalers.get(sensor_key)
    if not readings: return []

    values_to_predict = []
    original_readings_map = {}
    for i, r in enumerate(readings):
        value = r.sensorData.get(sensor_key)
        if value is not None:
            value_reshaped = np.array([[value]], dtype=np.float32)
            data_point_to_use = value_reshaped
            
            # --- Optional: Apply Scaling ---
            if scaler:
                try: 
                    data_point_to_use = scaler.transform(value_reshaped)
                except Exception as e: 
                    print(f"Scaling Error {sensor_key}: {e}"); continue
            # --- End Scaling ---
            
            values_to_predict.append(data_point_to_use)
            original_readings_map[len(values_to_predict) - 1] = r

    if not values_to_predict: return []
    try:
        batch_data = np.concatenate(values_to_predict, axis=0)
        predictions = model.predict(batch_data)
    except Exception as e: 
        print(f"Prediction Error ({sensor_key}): {e}"); return []

    for i, prediction in enumerate(predictions):
         if prediction == -1 and i in original_readings_map: # Check for anomaly (-1)
             anomalies.append(original_readings_map[i])
    return anomalies


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

    projection = {"timestamp": 1, "_id": 0, "nodeId": 1}
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
        
        processed_readings.append(SensorReading(nodeId=node_id, timestamp=r["timestamp"], sensorData=sd))
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
    """ Runs anomaly detection using the specific univariate model for the sensor. """
    if sensor not in loaded_models:
         print(f"No model configured for sensor '{sensor}'.")
         return []

    # --- THIS IS THE FIX ---
    # Now we call get_node_readings, but we pass Python values (like None)
    # instead of letting them default to Query(...) objects.
    readings_list = await get_node_readings(
        node_id=node_id, 
        range=range, # This is the string "latest24h"
        sensor=sensor, # This is the sensor string
        start_time=None, # This is a real None
        end_time=None # This is a real None
    )
    # --- END OF FIX ---
    
    if not readings_list: return []

    try:
        anomaly_readings = detect_anomalies_univariate(readings_list, sensor)
    except Exception as ex:
         print(f"ERROR running anomaly detection for {node_id}/{sensor}: {ex}")
         raise HTTPException(status_code=500, detail="Anomaly detection error.")
    
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
    print(f"Starting FastAPI server - Models loaded: {list(loaded_models.keys())}")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)