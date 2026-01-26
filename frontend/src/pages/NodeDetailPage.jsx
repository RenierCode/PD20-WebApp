import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'; // Import useCallback and useMemo
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import SensorGraph from '../components/SensorGraph'; 
import { LuChevronLeft, LuSignal } from 'react-icons/lu'; // Added LuSignal

const API_URL = 'http://127.0.0.1:8000';

// --- Card component for latest sensor data (from previous step) ---
const NodeLatestDataCard = ({ sensorKey, value, timestamp }) => {
  const formatTime = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="bg-white p-4 rounded-lg shadow-md">
      <div className="flex justify-between items-baseline mb-1">
        <div className="text-lg font-semibold text-gray-800 capitalize">{sensorKey}</div>
        <div className="font-mono text-xs text-gray-500">{formatTime(timestamp)}</div>
      </div>
      <div className="text-3xl font-bold text-blue-600 truncate" title={String(value)}>
        {typeof value === 'number' ? value.toFixed(2) : value}
      </div>
    </div>
  );
};


const NodeDetailPage = () => {
  const { nodeId } = useParams();
  
  const [initialData, setInitialData] = useState([]); 
  const [sensorKeys, setSensorKeys] = useState([]); 
  const [loading, setLoading] = useState(true); // For initial page load
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('24h'); // Default to 24 Hours
  const [fromNow, setFromNow] = useState(false); // Default to from latest data (more useful when no recent data)
  
  // Time range options
  const rangeOptions = [
    {value:'10m',label:'10 Minutes'},
    {value:'30m',label:'30 Minutes'},
    {value:'1h',label:'1 Hour'},
    {value:'6h',label:'6 Hours'},
    {value:'24h',label:'24 Hours'},
    {value:'7d',label:'7 Days'},
  ];
  
  // State to control anomaly detection for all graphs
  const [showAnomalies, setShowAnomalies] = useState(false);
  const [anomalyNotification, setAnomalyNotification] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSensorKey, setModalSensorKey] = useState(null);
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef(null);
  const [isDetecting, setIsDetecting] = useState(false);

  

  // --- MODIFIED: fetchInitialData is wrapped in useCallback ---
  // We add 'isPoll' to avoid resetting the main loading spinner
  const fetchInitialData = useCallback(async (isPoll = false) => {
    if (!isPoll) setLoading(true); // Only show full "Loading..." on first load
    setError(null);
    try {
      // Fetch data based on selected range and fromNow toggle
      const response = await axios.get(
        `${API_URL}/api/nodes/${nodeId}/readings?range=${timeRange}&fromNow=${fromNow}` 
      );
      
      const data = response.data;
      if (data.length > 0) {
        // Robustly find all sensor keys from all readings
        const allKeys = new Set();
        data.forEach(reading => {
          if (reading.sensorData) {
            Object.keys(reading.sensorData).forEach(key => allKeys.add(key));
          }
        });
        // Only update sensorKeys if we found new ones (preserve existing if no data)
        if (allKeys.size > 0) {
          setSensorKeys(Array.from(allKeys).sort());
        }
        setInitialData(data);
        setError(null); // Clear any previous error
      } else {
        // No data in this range - keep sensorKeys, just clear data
        setInitialData([]);
        // Don't show error, graphs will just be empty
      }
      
    } catch (err) {
      setError("Failed to fetch sensor readings.");
      console.error(err);
    } finally {
      if (!isPoll) setLoading(false);
    }
  }, [nodeId, timeRange, fromNow]); // Depends on nodeId, timeRange, and fromNow

  // Fetch sensor keys from node info (so we know what sensors exist even with no data in range)
  useEffect(() => {
    const fetchNodeInfo = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/nodes`);
        const node = response.data.find(n => n.nodeId === nodeId);
        if (node && node.sensors && node.sensors.length > 0) {
          setSensorKeys(node.sensors.sort());
        }
      } catch (err) {
        console.error('Failed to fetch node info:', err);
      }
    };
    if (nodeId) fetchNodeInfo();
  }, [nodeId]);

  // --- MODIFIED: This effect runs ONCE for initial load ---
  useEffect(() => {
    if (nodeId) fetchInitialData(false); // Call as a manual load
  }, [nodeId, fetchInitialData]); // Only depends on nodeId and the function
  
  // --- NEW: Polling useEffect ---
  useEffect(() => {
      const pollInterval = 5000; // Poll every 5 seconds
      console.log(`Setting up polling for ${nodeId}: ${pollInterval / 1000}s`);

      const intervalId = setInterval(() => {
          console.log(`Polling data for ${nodeId}...`);
          fetchInitialData(true); // Call as a background poll
      }, pollInterval);

      // Cleanup function to stop polling when leaving the page
      return () => {
          console.log(`Clearing polling for ${nodeId}.`);
          clearInterval(intervalId);
      };
  }, [fetchInitialData, nodeId]); // Restart poll if nodeId changes

  
  // --- Calculate latest data for each sensor (from previous step) ---
  const latestSensorData = useMemo(() => {
    if (initialData.length === 0 || sensorKeys.length === 0) {
      return [];
    }
    return sensorKeys.map(key => {
      const lastEntry = [...initialData].reverse().find(
        reading => reading.sensorData && reading.sensorData[key] != null
      );
      if (lastEntry) {
        return { sensorKey: key, value: lastEntry.sensorData[key], timestamp: new Date(lastEntry.timestamp) };
      }
      return null;
    }).filter(Boolean);
  }, [initialData, sensorKeys]);

  // Calculate the date range to display based on selected time range and data
  const dateRangeDisplay = useMemo(() => {
    const formatDate = (date) => {
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    };

    if (timeRange === 'all') {
      if (initialData.length === 0) return 'All Time';
      const firstDate = new Date(initialData[0].timestamp);
      const lastDate = new Date(initialData[initialData.length - 1].timestamp);
      return `${formatDate(firstDate)} - ${formatDate(lastDate)}`;
    }

    // Use current time as end for all ranges
    let endDate = new Date();
    let startDate;

    if (timeRange === '10m') {
      startDate = new Date(endDate.getTime() - 10 * 60 * 1000);
    } else if (timeRange === '30m') {
      startDate = new Date(endDate.getTime() - 30 * 60 * 1000);
    } else if (timeRange === '1h') {
      startDate = new Date(endDate.getTime() - 60 * 60 * 1000);
    } else if (timeRange === '6h') {
      startDate = new Date(endDate.getTime() - 6 * 60 * 60 * 1000);
    } else if (timeRange === '24h') {
      startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
    } else if (timeRange === '7d') {
      startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
    }

    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  }, [timeRange, initialData]);
  
  // Handler for the button (Unchanged)
  const toggleAnomalies = async () => {
    // If anomalies are currently shown, hide and clear notification
    if (showAnomalies) {
      setShowAnomalies(false);
      setAnomalyNotification(null);
      return;
    }

    // Otherwise, fetch fresh readings from backend and detect anomalies
    setIsDetecting(true);
    setAnomalyNotification(null);
    try {
      const resp = await axios.get(`${API_URL}/api/nodes/${nodeId}/readings?range=${timeRange}&fromNow=${fromNow}`);
      const readings = resp.data || [];

      // Build a flat list of anomalies per sensor from reading.anomalies (preferred)
      // Fallback: if reading.anomalies missing but reading.anomaly truthy, infer per-sensor flags using THRESHOLDS
      const anomalies = [];
      readings.forEach(r => {
          const flagged = Array.isArray(r?.anomalies) ? r.anomalies : [];
        if (Array.isArray(flagged) && flagged.length > 0 && r.sensorData) {
          flagged.forEach(k => {
            const val = r.sensorData?.[k];
            if (val != null) {
              anomalies.push({ sensorKey: k, timestamp: r.timestamp, value: val });
            }
          });
        }
      });

      if (anomalies.length > 0) {
        const bySensor = {};
        anomalies.forEach(a => {
          if (!bySensor[a.sensorKey]) bySensor[a.sensorKey] = [];
          bySensor[a.sensorKey].push(a);
        });
        setAnomalyNotification({ totalCount: anomalies.length, bySensor });
        setShowAnomalies(true); // Also enable anomaly visuals in graphs
      } else {
        // Provide user feedback: no anomalies found
        setAnomalyNotification({ totalCount: 0, bySensor: {} });
        setShowAnomalies(false);
      }
    } catch (err) {
      console.error('Error detecting anomalies on NodeDetailPage', err);
      setError('Failed to detect anomalies.');
    } finally {
      setIsDetecting(false);
    }
  };

    // Show a transient toast whenever anomalyNotification is set
    useEffect(() => {
      // Clear any existing timer
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }

      if (anomalyNotification) {
        setToastVisible(true);
        toastTimerRef.current = setTimeout(() => {
          setToastVisible(false);
          toastTimerRef.current = null;
        }, 5000);
      } else {
        setToastVisible(false);
      }

      return () => {
        if (toastTimerRef.current) {
          clearTimeout(toastTimerRef.current);
          toastTimerRef.current = null;
        }
      };
    }, [anomalyNotification]);

    // Show initial loading screen
    if (loading) return <div>Loading data...</div>;

  return (
    <div>
      <Link 
        to="/" 
        className="flex items-center gap-1 text-blue-500 hover:underline mb-4 text-lg"
      >
        <LuChevronLeft /> Back to Dashboard
      </Link>

      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-4xl font-bold">Sensor Data for {nodeId}</h1>
        {error && !loading && <div className="text-red-600 font-semibold">{error}</div>}
        <div className="flex items-center gap-3">
          <select 
            value={timeRange} 
            onChange={(e) => setTimeRange(e.target.value)} 
            className="p-2 border rounded-md bg-gray-50"
          >
            {rangeOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => setFromNow(!fromNow)}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${fromNow ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-green-100 text-green-700 border border-green-300'}`}
            title={fromNow ? 'Currently showing data relative to current time' : 'Currently showing data relative to latest data point'}
          >
            {fromNow ? 'From Now' : 'From Data'}
          </button>
          <button 
           className={`px-4 py-2 rounded-md font-semibold transition-colors
                     ${showAnomalies 
                       ? 'bg-red-500 hover:bg-red-600 text-white' 
                       : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
           onClick={toggleAnomalies}
           disabled={isDetecting}
          >
            {isDetecting ? 'Detecting...' : (showAnomalies ? 'Hide Anomalies' : 'Detect Anomalies')}
          </button>
        </div>
      </div>

      {/* Transient toast notification (appears for 5s) */}
      {toastVisible && anomalyNotification && (
        <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50">
          <div className={`max-w-sm w-full border rounded-md shadow-md px-4 py-3 flex items-center gap-3 ${anomalyNotification.totalCount > 0 ? 'bg-red-50 border-red-100 text-red-700' : 'bg-yellow-50 border-yellow-100 text-yellow-700'}`}>
            <div className="flex-1">
              <div className="font-semibold text-sm">{anomalyNotification.totalCount > 0 ? `${anomalyNotification.totalCount} anomaly${anomalyNotification.totalCount !== 1 ? 'ies' : ''} detected` : 'No anomalies found'}</div>
              {anomalyNotification.totalCount > 0 && <div className="text-xs text-gray-600">Click a sensor's "Show details" to view specific anomalies.</div>}
            </div>
            <button onClick={() => setToastVisible(false)} className="text-sm px-2 py-1 bg-white border rounded-md">Close</button>
          </div>
        </div>
      )}

      {/* --- Latest Readings Section (Updates via polling) --- */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Latest Readings</h2>
        {latestSensorData.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {latestSensorData.map(data => (
              <NodeLatestDataCard
                key={data.sensorKey}
                sensorKey={data.sensorKey}
                value={data.value}
                timestamp={data.timestamp}
              />
            ))}
          </div>
        ) : (
           <p className="p-4 bg-white rounded-lg text-gray-500">No latest data found for this node.</p>
        )}
      </section>

      {/* --- Sensor History (Graphs) Section (Updates via polling) --- */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Sensor History</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {!loading && !error && sensorKeys.length > 0 ? (
            sensorKeys.map((key, index) => {
              const isLastAndOdd = (index === sensorKeys.length - 1) && (sensorKeys.length % 2 !== 0);
              const itemClassName = isLastAndOdd ? 'lg:col-span-2' : '';

              return (
                <SensorGraph 
                  key={key}
                  nodeId={nodeId}
                  sensorKey={key}
                  initialData={initialData} // This prop now updates from polling
                  className={itemClassName}
                  showAnomalies={showAnomalies}
                  timeRange={timeRange}
                  fromNow={fromNow}
                  anomalyCount={anomalyNotification?.bySensor?.[key]?.length || 0}
                  onShowAnomalyDetails={(sensor) => {
                    // Open modal with details for this sensor
                    setModalSensorKey(sensor);
                    setModalOpen(true);
                  }}
                />
              );
            })
          ) : (
            !loading && <p>No sensor data graphs to display.</p>
          )}
        </div>
      </section>
      {/* Modal for sensor anomaly details */}
      {modalOpen && modalSensorKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black opacity-40" onClick={() => setModalOpen(false)} />
          <div className="relative bg-white rounded-md shadow-lg max-w-2xl w-full mx-4 p-6 z-10">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Anomalies for {modalSensorKey}</h3>
              <button onClick={() => setModalOpen(false)} className="text-sm px-2 py-1 bg-gray-100 rounded-md">Close</button>
            </div>
            <div className="max-h-72 overflow-auto">
              <ul className="divide-y">
                {(() => {
                  const list = anomalyNotification?.bySensor?.[modalSensorKey] || [];
                  if (list.length === 0) {
                    return <li className="py-2 text-gray-500">No anomalies for this sensor.</li>;
                  }
                  return list.map((a, idx) => (
                    <li key={idx} className="py-2 flex justify-between">
                      <span className="text-gray-700">{new Date(a.timestamp).toLocaleString()}</span>
                      <span className="font-mono">{a.value}</span>
                    </li>
                  ));
                })()}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NodeDetailPage;