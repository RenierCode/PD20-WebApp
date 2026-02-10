# Quick script to check anomaly status
import pymongo
import os
import joblib
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
client = pymongo.MongoClient(os.getenv("DATABASE_URL"))
db = client["sensorDB"]
coll = db["sensorReadings"]

# Check anomalies by sensor
pipeline = [
    {"$match": {"anomalies": {"$exists": True, "$ne": []}}},
    {"$unwind": "$anomalies"},
    {"$group": {"_id": "$anomalies", "count": {"$sum": 1}}},
    {"$sort": {"count": -1}}
]
results = list(coll.aggregate(pipeline))
print("Anomalies by sensor:")
for r in results:
    print(f"  {r['_id']}: {r['count']}")

# Check sample flowRate values
print("\nSample flowRate values:")
samples = list(coll.find({"sensorData.flowRate": {"$exists": True}}).limit(5))
for s in samples:
    val = s["sensorData"].get("flowRate")
    anomaly = s.get("anomaly", "N/A")
    anomalies = s.get("anomalies", [])
    print(f"  value={val}, anomaly={anomaly}, anomalies={anomalies}")

# Test the flowRate model directly
print("\n--- Testing flowRate model ---")
model_path = Path(__file__).parent / "models" / "IF_flow_rate.joblib"
if model_path.exists():
    model = joblib.load(model_path)
    test_values = [0.0, 50.0, 100.0, 200.0, 300.0, 400.0]
    print(f"Model loaded from {model_path}")
    print("Testing predictions (−1 = anomaly, 1 = normal):")
    for v in test_values:
        pred = model.predict([[v]])[0]
        print(f"  flowRate={v}: prediction={pred} ({'ANOMALY' if pred == -1 else 'normal'})")
else:
    print(f"Model not found at {model_path}")

client.close()
