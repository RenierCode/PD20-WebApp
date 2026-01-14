import pymongo
from datetime import datetime
import time
import random
import numpy as np
import os
from dotenv import load_dotenv
import signal # For graceful shutdown

# --- Load Environment Variables ---
load_dotenv()
MONGO_URI = os.getenv("DATABASE_URL")
DB_NAME = "sensorDB"

if not MONGO_URI:
    raise Exception("DATABASE_URL not found in .env file.")

# --- Configuration ---
NODE_COLLECTION = "nodes"
READINGS_COLLECTION = "sensorReadings"
SEND_INTERVAL_SECONDS = 5 # Send data every 5 seconds

# --- Connect to MongoDB ---
print("Connecting to MongoDB Atlas...")
try:
    client = pymongo.MongoClient(MONGO_URI)
    db = client[DB_NAME]
    nodes_collection = db[NODE_COLLECTION]
    readings_collection = db[READINGS_COLLECTION]
    # Test connection
    client.admin.command('ping')
    print("MongoDB connection successful.")
except Exception as e:
    print(f"Error connecting to MongoDB: {e}")
    exit(1)

# --- Define Sample Nodes ---
# We use update_one with upsert=True to create nodes if they don't exist,
# or update them if they do (e.g., if you change the sensor list later).
# This avoids deleting existing nodes.
nodes_to_ensure = [
    { "_id": "node-001", "sensors": ["flowRate", "waterLevel", "pH", "turbidity", "temperature"], },
    { "_id": "node-002", "sensors": ["flowRate", "pH", "turbidity"], },
    { "_id": "node-003", "sensors": ["waterLevel", "temperature"], }
]

print("Ensuring nodes exist in the database...")
for node_def in nodes_to_ensure:
    nodes_collection.update_one(
        {"_id": node_def["_id"]}, # Filter by node ID
        {"$set": {"sensors": node_def["sensors"]}}, # Set the sensor list
        upsert=True # Create if it doesn't exist
    )
print(f"Nodes are present/updated in '{NODE_COLLECTION}'.")

# --- Function to generate data for one node ---
def generate_sensor_reading(node):
    """Generates a reading dictionary for a single node."""
    sensor_data = {}
    current_time = datetime.utcnow() # Use current time for each reading

    # Generate data based on the node's sensors
    if "temperature" in node["sensors"]:
        # Water temperature in °C
        sensor_data["temperature"] = round(22 + np.random.randn() * 2.5, 2)
    if "pH" in node["sensors"]:
        sensor_data["pH"] = round(7.0 + np.random.randn() * 0.3, 2)
    if "turbidity" in node["sensors"]:
        sensor_data["turbidity"] = round(max(0, 4 + np.random.randn() * 1.8), 2)
    if "flowRate" in node["sensors"]:
        # Flow rate in liters/hour (example)
        sensor_data["flowRate"] = round(max(0, 150 + np.random.randn() * 25), 2)
    if "waterLevel" in node["sensors"]:
        # Water level in meters
        sensor_data["waterLevel"] = round(max(0, 2.5 + np.random.randn() * 0.5), 2)

    if sensor_data: # Only return if data was generated
        return {
            "nodeId": node["_id"],
            "timestamp": current_time,
            "sensorData": sensor_data
        }
    return None

# --- Main Loop ---
running = True
def signal_handler(sig, frame):
    """Handles Ctrl+C signal for graceful shutdown."""
    global running
    print("\nCtrl+C detected. Stopping data generation...")
    running = False

signal.signal(signal.SIGINT, signal_handler) # Register the handler

print(f"Starting data generation loop (every {SEND_INTERVAL_SECONDS} seconds)... Press Ctrl+C to stop.")

while running:
    # Fetch the current list of nodes in case it changes
    # (though in this script it's fixed, this is good practice)
    current_nodes = list(nodes_collection.find({}, {"_id": 1, "sensors": 1}))
    readings_batch = []

    for node in current_nodes:
        reading = generate_sensor_reading(node)
        if reading:
            readings_batch.append(reading)

    # Insert the batch of readings if any were generated
    if readings_batch:
        try:
            insert_result = readings_collection.insert_many(readings_batch)
            print(f"{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} - Sent {len(insert_result.inserted_ids)} readings to DB.")
        except Exception as e:
            print(f"Error inserting batch into MongoDB: {e}")

    # Wait for the specified interval before the next iteration
    # Use a loop with shorter sleeps to check 'running' flag more often
    for _ in range(SEND_INTERVAL_SECONDS * 2): # Check every 0.5 seconds
        if not running:
            break
        time.sleep(0.5)

# --- Cleanup ---
print("Closing MongoDB connection.")
if client:
    client.close()

print("Script finished.")