import pymongo
from datetime import datetime, timedelta
import time
import random
import os
from dotenv import load_dotenv
import argparse

# --- Load Environment Variables ---
load_dotenv()
MONGO_URI = os.getenv("DATABASE_URL")
DB_NAME = "sensorDB"
READINGS_COLLECTION = "sensorReadings"

if not MONGO_URI:
    raise Exception("DATABASE_URL not found in .env file.")

# --- Configurable variables (edit here or pass via CLI) ---
# Number of readings to insert
POPULATE = 45
# Node id to assign readings to
NODE_ID = "node-001"
# Define how many anomalies to create for each sensor within the POPULATE set
# Keys must match sensor names used in your DB: flowRate, waterLevel, pH, turbidity, temperature
ANOMALY_COUNTS = {
    "pH": 0,
    "temperature": 1,
    "flowRate": 1,
    "turbidity": 0,
    "waterLevel": 1,
}

# Optional: predefined node list to populate for when using --all
NODES_TO_ENSURE = [
    {"_id": "node-001", "sensors": ["flowRate", "waterLevel", "pH", "turbidity", "temperature"]},
    {"_id": "node-002", "sensors": ["flowRate", "pH", "turbidity"]},
    {"_id": "node-003", "sensors": ["waterLevel", "temperature"]},
]

# --- Thresholds used to determine normal/anomalous ranges (match processData.py) ---
THRESHOLDS = {
    "flowRate": {"min": 50.0, "max": 300.0},
    "waterLevel": {"min": 0.2, "max": 5.0},
    "pH": {"min": 6.5, "max": 8.0},
    "turbidity": {"min": 0.0, "max": 10.0},
    "temperature": {"min": 5.0, "max": 35.0},
}


def connect_db():
    client = pymongo.MongoClient(MONGO_URI)
    db = client[DB_NAME]
    return client, db


def normal_value(sensor_key):
    rule = THRESHOLDS.get(sensor_key)
    if not rule:
        return None
    low = rule.get("min", 0)
    high = rule.get("max", low + 10)
    # return value near center with some noise
    mean = (low + high) / 2.0
    span = (high - low) / 4.0
    return round(max(0, random.gauss(mean, span)), 2)


def anomalous_value(sensor_key):
    """Return a value clearly outside the threshold range (either below min or above max)."""
    rule = THRESHOLDS.get(sensor_key)
    if not rule:
        return None
    low = rule.get("min")
    high = rule.get("max")
    # Randomly decide low or high anomaly
    if random.choice([True, False]):
        # below low
        mag = (low if low is not None else 0) - random.uniform(0.5, max(1.0, (high or 0) * 0.1 + 0.5))
        return round(mag, 2)
    else:
        # above high
        mag = (high if high is not None else 0) + random.uniform(0.5, max(1.0, (high or 0) * 0.1 + 0.5))
        return round(mag, 2)


def build_readings(populate, node_id, anomaly_counts):
    readings = []
    now = datetime.utcnow()

    # Create base readings (no anomalies yet)
    for i in range(populate):
        # stagger timestamps slightly backwards so they are unique
        ts = now - timedelta(seconds=(populate - i) * 5)
        sensor_data = {}
        # generate normal values for all sensors known in THRESHOLDS
        for k in THRESHOLDS.keys():
            sensor_data[k] = normal_value(k)

        readings.append({
            "nodeId": node_id,
            "timestamp": ts,
            "sensorData": sensor_data,
        })

    # For each sensor, randomly choose indices within readings to mark anomalies
    for sensor_key, cnt in anomaly_counts.items():
        if cnt <= 0 or sensor_key not in THRESHOLDS:
            continue
        cnt = min(cnt, populate)
        indices = random.sample(range(populate), cnt)
        for idx in indices:
            val = anomalous_value(sensor_key)
            readings[idx]["sensorData"][sensor_key] = val

    # Do not attach 'anomalies' or 'anomaly' fields here.
    # processData.py should be used to detect and tag anomalies later.

    return readings


def insert_readings(readings):
    client, db = connect_db()
    try:
        coll = db[READINGS_COLLECTION]
        # Convert datetime objects to datetimes (MongoDB driver handles datetimes)
        result = coll.insert_many(readings)
        print(f"Inserted {len(result.inserted_ids)} readings into '{READINGS_COLLECTION}'.")
    finally:
        client.close()


def parse_args():
    p = argparse.ArgumentParser(description="Populate sensorReadings with selectable anomalies")
    p.add_argument("--populate", type=int, default=POPULATE, help="Total number of readings to insert")
    p.add_argument("--anomalypH", type=int, default=ANOMALY_COUNTS.get("pH", 0), help="Number of pH anomalies")
    p.add_argument("--anomalyTemp", type=int, default=ANOMALY_COUNTS.get("temperature", 0), help="Number of temperature anomalies")
    p.add_argument("--anomalyFlow", type=int, default=ANOMALY_COUNTS.get("flowRate", 0), help="Number of flowRate anomalies")
    p.add_argument("--anomalyTurbidity", type=int, default=ANOMALY_COUNTS.get("turbidity", 0), help="Number of turbidity anomalies")
    p.add_argument("--anomalyLevel", type=int, default=ANOMALY_COUNTS.get("waterLevel", 0), help="Number of waterLevel anomalies")
    p.add_argument("--all", action='store_true', help="Populate readings for all nodes in the built-in NODES_TO_ENSURE list")
    p.add_argument("--nodesFromDb", action='store_true', help="Populate readings for all nodes currently in the nodes collection in the DB")
    return p.parse_args()


def main():
    args = parse_args()
    anomaly_counts = {
        "pH": args.anomalypH,
        "temperature": args.anomalyTemp,
        "flowRate": args.anomalyFlow,
        "turbidity": args.anomalyTurbidity,
        "waterLevel": args.anomalyLevel,
    }

    targets = []
    if args.nodesFromDb:
        # read nodes collection from DB
        client, db = connect_db()
        try:
            coll = db['nodes']
            docs = list(coll.find({}, {'_id': 1, 'sensors': 1}))
            for d in docs:
                targets.append({'_id': d.get('_id'), 'sensors': d.get('sensors', [])})
        finally:
            client.close()
    else:
        # By default (and when --all provided) use the built-in nodes list
        targets = NODES_TO_ENSURE

    print(f"Populating {args.populate} readings for targets: {[t['_id'] for t in targets]}")
    print(f"Anomaly counts (per-target): {anomaly_counts}")

    # Build all readings immediately. Each node will get `args.populate` readings
    # with timestamps spaced by 5 seconds (most recent first). This inserts all
    # documents in a single bulk insert while preserving the 5s spacing in the data.
    all_readings = []
    for target in targets:
        node_id = target["_id"]
        # build_readings generates `args.populate` readings with 5s spacing
        r = build_readings(args.populate, node_id, anomaly_counts)
        all_readings.extend(r)

    # Show summary of which indices have values outside thresholds (so processData will detect them)
    summary = {}
    for idx, r in enumerate(all_readings):
        out = []
        for k, v in r["sensorData"].items():
            rule = THRESHOLDS.get(k)
            if not rule or v is None:
                continue
            minv = rule.get("min")
            maxv = rule.get("max")
            try:
                nv = float(v)
            except Exception:
                continue
            if (minv is not None and nv < minv) or (maxv is not None and nv > maxv):
                out.append(k)
        if out:
            summary[idx] = out

    if summary:
        print("Values outside thresholds were inserted at indices (these will be detected as anomalies by processData):")
        for idx, sensors in summary.items():
            print(f" - index {idx}: {sensors}")
    else:
        print("No out-of-threshold values inserted.")

    insert_readings(all_readings)


if __name__ == '__main__':
    main()
