import pymongo
import random
import os
import signal
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv
import argparse

# Load env
load_dotenv()
MONGO_URI = os.getenv("DATABASE_URL")
DB_NAME = "sensorDB"
READINGS_COLLECTION = "sensorReadings"

if not MONGO_URI:
    raise Exception("DATABASE_URL not found in .env file.")

# Default node definitions
NODES_TO_ENSURE = [
    {"_id": "node-001", "sensors": ["flowRate", "waterLevel", "pH", "turbidity", "temperature"]},
    {"_id": "node-002", "sensors": ["flowRate", "pH", "turbidity"]},
    {"_id": "node-003", "sensors": ["waterLevel", "temperature"]},
]

# Thresholds (keep in sync with processData.py)
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
    mean = (low + high) / 2.0
    span = (high - low) / 4.0
    return round(max(0, random.gauss(mean, span)), 2)


def anomalous_value(sensor_key):
    rule = THRESHOLDS.get(sensor_key)
    if not rule:
        return None
    low = rule.get("min")
    high = rule.get("max")
    if random.choice([True, False]):
        # below low
        mag = (low if low is not None else 0) - random.uniform(0.5, max(1.0, (high or 0) * 0.1 + 0.5))
        return round(mag, 2)
    else:
        mag = (high if high is not None else 0) + random.uniform(0.5, max(1.0, (high or 0) * 0.1 + 0.5))
        return round(mag, 2)


def check_for_anomaly(sensor_data):
    anomalies = []
    for sensor_key, value in sensor_data.items():
        if sensor_key in THRESHOLDS:
            rule = THRESHOLDS[sensor_key]
            min_val = rule.get("min")
            max_val = rule.get("max")
            if value is None:
                continue
            try:
                numeric_value = float(value)
            except Exception:
                continue
            if min_val is not None and numeric_value < min_val:
                anomalies.append(sensor_key)
                continue
            if max_val is not None and numeric_value > max_val:
                anomalies.append(sensor_key)
                continue
    return anomalies


def ensure_nodes(nodes):
    client, db = connect_db()
    try:
        coll = db['nodes']
        for node in nodes:
            coll.update_one({"_id": node["_id"]}, {"$set": {"sensors": node.get("sensors", [])}}, upsert=True)
    finally:
        client.close()


def run_continuous(interval, seed, use_db_nodes, anomaly_rate):
    random.seed(seed)
    # Determine targets
    if use_db_nodes:
        client, db = connect_db()
        try:
            docs = list(db['nodes'].find({}, {'_id': 1, 'sensors': 1}))
            targets = [{'_id': d.get('_id'), 'sensors': d.get('sensors', [])} for d in docs]
        finally:
            client.close()
    else:
        targets = NODES_TO_ENSURE

    ensure_nodes(targets)

    client = pymongo.MongoClient(MONGO_URI)
    db = client[DB_NAME]
    coll = db[READINGS_COLLECTION]

    running = True

    def _signal_handler(sig, frame):
        nonlocal running
        print("Received stop signal, shutting down gracefully...")
        running = False

    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    print(f"Starting continuous generate+process loop: interval={interval}s, anomaly_rate={anomaly_rate}")
    while running:
        batch = []
        ts = datetime.utcnow()
        for target in targets:
            node_id = target['_id']
            sensor_data = {}
            # generate default normal values only for sensors listed for the node
            for k in target.get('sensors', THRESHOLDS.keys()):
                if k not in THRESHOLDS:
                    continue
                # decide whether to inject an anomaly for this sensor reading
                if random.random() < anomaly_rate:
                    sensor_data[k] = anomalous_value(k)
                else:
                    sensor_data[k] = normal_value(k)

            anomalies = check_for_anomaly(sensor_data)
            doc = {
                'nodeId': node_id,
                'timestamp': ts,
                'sensorData': sensor_data,
                'anomalies': anomalies,
                'anomaly': 1 if anomalies else 0,
            }
            batch.append(doc)

        try:
            coll.insert_many(batch)
            print(f"{datetime.utcnow().isoformat()} - Inserted batch of {len(batch)} readings")
        except Exception as e:
            print(f"Insertion error: {e}")

        # Sleep until next interval
        sleep_seconds = interval
        for _ in range(int(sleep_seconds * 10)):
            if not running:
                break
            time.sleep(0.1)

    client.close()
    print("Stopped.")


def parse_args():
    p = argparse.ArgumentParser(description='Continuously populate readings and tag anomalies')
    p.add_argument('--interval', type=float, default=5.0, help='Seconds between generated readings')
    p.add_argument('--seed', type=int, default=12345, help='Random seed for reproducible anomalies')
    p.add_argument('--nodesFromDb', action='store_true', help='Read node list from DB instead of built-in list')
    p.add_argument('--anomalyRate', type=float, default=0.05, help='Probability of an anomaly per sensor per reading (0-1)')
    return p.parse_args()


if __name__ == '__main__':
    args = parse_args()
    run_continuous(args.interval, args.seed, args.nodesFromDb, args.anomalyRate)
