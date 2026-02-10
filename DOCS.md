# Backend Documentation

## main.py - FastAPI Backend Server

This is the main backend server for the PD20 Water Quality Monitoring System.
It provides REST API endpoints for:
- Retrieving sensor readings from IoT nodes
- Running anomaly detection using Isolation Forest ML models
- Getting statistics about detected anomalies
- Automatic background anomaly detection when new data arrives

### Key Features
- Async MongoDB operations using Motor driver for high performance
- Integrated ML-based anomaly detection (no subprocess needed)
- Auto-detection: Runs anomaly detection when untagged readings exceed threshold
- Fallback to threshold-based detection when ML models unavailable

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/nodes` | List all sensor nodes with status |
| GET | `/api/nodes/{id}/readings` | Get readings for a specific node |
| GET | `/api/nodes/{id}/anomalies` | Get anomaly points for graphing |
| GET | `/api/data/sensor/{name}` | Get data for a sensor across all nodes |
| POST | `/api/anomaly/detect` | Trigger anomaly detection manually |
| GET | `/api/anomaly/status` | Check detection status and unprocessed count |
| GET | `/api/anomaly/stats` | Get anomaly statistics breakdown |

### Usage
```bash
python main.py                 # Start server on http://127.0.0.1:8000
uvicorn main:app --reload      # Start with hot-reload for development
```

---

## config.py - Shared Configuration

Centralizes all configuration used by the anomaly detection system.

### Used By
- `main.py` (FastAPI backend) - for real-time anomaly detection
- `processData.py` (CLI tool) - for batch processing historical data
- `populate_*.py` scripts - for generating test data with known anomalies

### SENSOR_MODEL_MAP
Maps sensor names to their corresponding trained Isolation Forest model files.
Includes aliases (e.g., "pH" and "pH_level" both map to the same model).

| Sensor | Model File | Description |
|--------|------------|-------------|
| temperature | IF_temperature.joblib | Water temperature (°C) |
| pH / pH_level | IF_pH_level.joblib | Acidity/alkalinity |
| turbidity | IF_turbidity.joblib | Water clarity (NTU) |
| flowRate / flow_rate | IF_flow_rate.joblib | Water flow (L/hr) |
| waterLevel / water_level | IF_water_level.joblib | Depth (meters) |

### THRESHOLDS (Fallback Detection)
Defines acceptable ranges for each sensor type. Values outside these ranges
are flagged as anomalies when ML models are unavailable.

| Sensor | Min | Max | Notes |
|--------|-----|-----|-------|
| flowRate | 50.0 | 300.0 | Normal pump operation (L/hr) |
| waterLevel | 0.2 | 5.0 | Normal tank level (m) |
| pH | 6.5 | 8.5 | Safe for aquatic life |
| turbidity | 0.0 | 10.0 | Clear water (NTU) |
| temperature | 5.0 | 35.0 | Typical water systems (°C) |

---

## processData.py - Batch Anomaly Detection CLI

Command-line utility for manual batch processing of sensor data.
For most use cases, anomaly detection is handled automatically by the backend.

### When to Use
- Reprocess all historical data after model updates
- Process data for a specific node only
- Run detection without starting the full backend

### Usage
```bash
python processData.py                    # Process all unprocessed data
python processData.py --all              # Reprocess all data
python processData.py --node node-001    # Process specific node
python processData.py --threshold        # Use threshold-based detection
python processData.py --stats            # Show statistics only
```

---

## clear_anomalies.py - Reset Anomaly Tags

Removes all anomaly-related fields from sensor readings in the database.

### When to Use
- Re-run anomaly detection from scratch after model updates
- Clear false positives from poorly calibrated models
- Reset the database for testing purposes

### Fields Removed
- `anomaly` - Binary flag (0 or 1)
- `anomalies` - List of flagged sensor names
- `anomaly_processed_at` - Processing timestamp

### Usage
```bash
python clear_anomalies.py
```

⚠️ **Warning**: This operation cannot be undone!

---
---

# Frontend Documentation

## Pages

### Dashboard.jsx - Main Dashboard Page

Main dashboard for the PD20 Water Quality Monitoring System.
Displays sensor data visualization, anomaly detection controls, and statistics.

#### Features
- Summary statistics (total nodes, sensor types, instances)
- Anomaly detection panel with "Show Anomalies" and "Detect New" buttons
- Interactive sensor graph with time range selection
- Latest readings cards for each node
- Auto-polling every 10 seconds for live updates

#### Anomaly Visualization
The graph highlights detected anomalies as red triangles when "Show Anomalies"
is enabled, making it easy to spot problematic readings visually.

#### Components
| Component | Description |
|-----------|-------------|
| `SummaryStatCard` | Displays a single statistic with icon |
| `LatestDataCard` | Shows most recent reading for a node |
| `SummaryGraph` | Line chart with anomaly highlighting |

---

### NodeDetailPage.jsx - Node Detail View

Detailed view for a single sensor node showing all its sensors and readings.

#### Features
- Displays all sensors for the selected node
- Individual graphs for each sensor type
- Latest reading cards with timestamps
- Time range selection per sensor

---

### SensorsNode.jsx - Nodes List Page

Grid view of all sensor nodes in the system.

#### Features
- Card layout showing all nodes
- Status indicator (Active/Inactive)
- Last seen timestamp
- Click to navigate to node detail

---

### MapPage.jsx - Geographic Map View

Interactive map showing sensor node locations.

#### Features
- Leaflet-based map visualization
- Node markers with popups
- Predefined locations for demo (Subic Pier, etc.)

---

### Reports.jsx - Report Generation

Generate and export sensor data reports.

#### Features
- Date range selection with datetime pickers
- Export to PDF (jsPDF)
- Export to CSV (PapaParse)
- Preview chart before export

---

## Components

### SensorGraph.jsx - Reusable Sensor Chart

Line chart component for displaying sensor readings over time.

#### Props
| Prop | Type | Description |
|------|------|-------------|
| `nodeId` | string | ID of the node to display |
| `sensorKey` | string | Sensor type (e.g., "pH", "temperature") |
| `timeRange` | string | Time window ('10m', '1h', '24h', etc.) |
| `fromNow` | boolean | If true, range is from current time |
| `showAnomalies` | boolean | Toggle anomaly markers |

#### Features
- Auto-polling for live updates
- Anomaly point highlighting
- Responsive design

---

### Sidebar.jsx - Navigation Sidebar

Collapsible sidebar for app navigation.

#### Navigation Items
| Route | Icon | Label |
|-------|------|-------|
| `/` | Dashboard | Dashboard |
| `/nodes` | Network | Nodes |
| `/map` | Map | Map |
| `/reports` | FileText | Reports |
