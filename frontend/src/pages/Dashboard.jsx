// Dashboard.jsx - Main Dashboard Page
// See DOCS.md in project root for full documentation

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { LuTags, LuDatabaseZap, LuTriangleAlert, LuPlay, LuRefreshCw, LuEye, LuEyeOff } from 'react-icons/lu';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, TimeScale,
} from 'chart.js';
import 'chartjs-adapter-date-fns';

// Register Chart.js components for time-series visualization
ChartJS.register( CategoryScale, LinearScale, PointElement, LineElement, TimeScale, Title, Tooltip, Legend );

// Backend API base URL
const API_URL = 'http://127.0.0.1:8000';

// Bright, distinct colors for differentiating multiple nodes on the graph
const BRIGHT_COLORS = [ '#E6194B', '#3CB44B', '#0082C8', '#F58231', '#911EB4', '#46F0F0', '#F032E6', '#FFE119', ];

// Fisher-Yates shuffle to randomize colors so each session looks different
const shuffleColors = () => { const a=[...BRIGHT_COLORS]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };

/**
 * SummaryStatCard - Displays a single statistic with an icon
 * Used for Total Nodes, Sensor Types, and Sensor Instances counts
 */
const SummaryStatCard = ({ title, value, icon }) => ( <div className="bg-white p-6 rounded-lg shadow-md flex items-center gap-4"><div className="text-3xl text-blue-500">{icon}</div><div><div className="text-sm font-medium text-gray-500">{title}</div><div className="text-3xl font-bold">{value}</div></div></div> );


/**
 * LatestDataCard - Shows the most recent reading for a single node
 * Displays: node ID, timestamp, value, and sensor type
 */
const LatestDataCard = ({ nodeId, value, timestamp, sensorKey }) => {
  const formatTime = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return (
    <div className="bg-gray-50 p-4 rounded-lg shadow-sm">
      <div className="flex justify-between items-baseline gap-2">
         <div className="text-lg font-semibold text-gray-800">{nodeId}</div>
         <div className="font-mono text-xs text-gray-500">{formatTime(timestamp)}</div>
      </div>
      <div className="text-3xl font-bold text-gray-900 truncate" title={String(value)}>
        {typeof value === 'number' ? value.toFixed(2) : value}
      </div>
      <div className="text-xs text-gray-500 capitalize">{sensorKey}</div>
    </div>
  );
};


/**
 * SummaryGraph - Main sensor data visualization component
 * 
 * Displays a line chart showing sensor readings over time for all nodes.
 * When anomaly display is enabled, overlays red triangle markers on
 * data points that were flagged as anomalous by the ML detection system.
 * 
 * Props:
 *   - rawGraphData: Array of timestamp + node values from API
 *   - anomalyReadings: Array of anomaly points to highlight
 *   - showAnomalies: Boolean toggle for anomaly visibility
 *   - nodeColors: Array of colors for each node's line
 *   - selectedSensor: Currently selected sensor type
 */
const SummaryGraph = ({ rawGraphData, anomalyReadings = [], showAnomalies, nodeColors, isLoading, error, selectedSensor }) => {
  const [chartData, setChartData] = useState({ labels: [], datasets: [] });

  const transformDataForChartJS = useCallback((apiData, anomalies, showAnom, colors) => {
    if (!apiData || apiData.length === 0) return { labels: [], datasets: [] };
    const nodeKeySet = new Set(apiData.flatMap(item => Object.keys(item).filter(key => key !== 'timestamp')));
    const nodeKeys = Array.from(nodeKeySet);
    const labels = apiData.map((item) => item.timestamp);
    const datasets = nodeKeys.map((nodeId, index) => ({
      label: nodeId,
      data: apiData.map((item) => item[nodeId] ?? null),
      borderColor: colors[index % colors.length],
      backgroundColor: `${colors[index % colors.length]}80`,
      fill: false,
      tension: 0.1,
      spanGaps: true,
    }));
    
    // Add anomaly points as a separate dataset if showAnomalies is enabled
    if (showAnom && anomalies && anomalies.length > 0) {
      const anomalyPoints = anomalies.map(a => ({
        x: new Date(a.timestamp),
        y: a.value,
        nodeId: a.nodeId
      }));
      
      datasets.push({
        label: 'Anomalies',
        data: anomalyPoints,
        backgroundColor: '#FF0000',
        borderColor: '#FF0000',
        pointRadius: 8,
        pointHoverRadius: 10,
        pointStyle: 'triangle',
        showLine: false,
        order: -1, // Draw on top
      });
    }
    
    return { labels, datasets };
  }, []);

  useEffect(() => {
    setChartData(transformDataForChartJS(rawGraphData, anomalyReadings, showAnomalies, nodeColors));
  }, [rawGraphData, anomalyReadings, showAnomalies, nodeColors, transformDataForChartJS]);
  
  const chartOptions = { 
    responsive: true, 
    maintainAspectRatio: false, 
    interaction: { mode: 'x', intersect: false }, 
    plugins: { 
      legend: { position: 'top' }, 
      tooltip: { mode: 'x', intersect: false } 
    }, 
    scales: {
      x: {
        type: 'time',
        time: {
          displayFormats: {
            minute: 'MM/dd/yyyy h:mm a',
            hour: 'MM/dd/yyyy h a',
            day: 'MM/dd/yyyy',
            month: 'MM/yyyy'
          },
          tooltipFormat: 'MM/dd/yyyy h:mm:ss a'
        },
        ticks: {
          maxTicksLimit: 10,
          autoSkip: true,
          autoSkipPadding: 20
        },
        title: { display: true, text: 'Timestamp' }
      },
      y: { title: { display: true, text: 'Value' } }
    }
  };
  
  if (!selectedSensor) {
     return (<div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg"><p className="text-gray-500">Please select a sensor.</p></div>);
  }
  if (isLoading && chartData.datasets.length === 0) {
    return <div className="flex items-center justify-center h-96"><p>Loading graph data...</p></div>;
  }
  if (error) {
    return <div className="flex items-center justify-center h-96 text-red-600 font-semibold">{error}</div>;
  }
  if (chartData.datasets.length === 0 && !isLoading) {
     return (<div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg"><p className="text-gray-500">No data found for this selection.</p></div>);
  }
  
  return (<div style={{height:'400px'}}><Line options={chartOptions} data={chartData} /></div>);
};


/**
 * Dashboard - Main page component
 * 
 * State Management:
 *   - nodes: List of all sensor nodes from the API
 *   - selectedSensor: Currently selected sensor type for the graph
 *   - timeRange: Time window to display (10m, 30m, 1h, 6h, 24h, 7d)
 *   - fromNow: If true, time range is from current time. If false, from latest data.
 *   - anomalyStats: Statistics about detected anomalies
 *   - showAnomalies: Toggle for displaying anomaly markers on graph
 * 
 * Auto-polling runs every 10 seconds to keep data fresh without manual refresh.
 */
const Dashboard = () => {
  // =========================================================================
  // STATE DECLARATIONS
  // =========================================================================
  
  // Node and loading state
  const [nodes, setNodes] = useState([]);           // All sensor nodes
  const [loading, setLoading] = useState(true);     // Initial page load
  const [error, setError] = useState(null);         // Error message
  
  // Sensor selection and time range
  const [selectedSensor, setSelectedSensor] = useState('');     // e.g., "pH", "temperature"
  const [timeRange, setTimeRange] = useState('24h');            // Time window for graph
  const [fromNow, setFromNow] = useState(true);                 // true = from now, false = from latest data
  const [lineColors, setLineColors] = useState(() => shuffleColors());  // Random colors per session
  const [graphRefetchTrigger, setGraphRefetchTrigger] = useState(0);    // Incremented to trigger poll refetch

  // Graph data state
  const [rawGraphData, setRawGraphData] = useState([]);         // Sensor readings for graph
  const [anomalyReadings, setAnomalyReadings] = useState([]);   // Anomaly points to highlight
  const [graphLoading, setGraphLoading] = useState(false);      // Graph-specific loading
  const [graphError, setGraphError] = useState(null);           // Graph-specific error

  // Anomaly detection state
  const [anomalyStats, setAnomalyStats] = useState(null);       // Stats from /api/anomaly/stats
  const [anomalyRunning, setAnomalyRunning] = useState(false);  // Is detection currently running?
  const [anomalyMessage, setAnomalyMessage] = useState(null);   // Success/error message
  const [showAnomalies, setShowAnomalies] = useState(false);    // Toggle anomaly display on graph

  // Time range dropdown options
  const rangeOptions = [{value:'10m',label:'10 Minutes'},{value:'30m',label:'30 Minutes'},{value:'1h',label:'1 Hour'},{value:'6h',label:'6 Hours'},{value:'24h',label:'24 Hours'},{value:'7d',label:'7 Days'},];

  // =========================================================================
  // DATA FETCHING FUNCTIONS
  // =========================================================================

  /** Fetch list of all nodes from the API */
  const fetchNodes = useCallback(async () => { 
    try { const r = await axios.get(`${API_URL}/api/nodes`); setNodes(r.data); } 
    catch(e){ setError("Node poll error."); console.error("Poll:", e); } 
  }, []);

  /** Fetch sensor data and anomaly points for the graph */
  const fetchGraphData = useCallback(async (isPoll = false) => {
    if (!selectedSensor) { setRawGraphData([]); setAnomalyReadings([]); return; }
    if (!isPoll) setGraphLoading(true);  // Only show loading on manual fetch, not polls
    setGraphError(null);
    try {
      // Fetch main sensor data
      const r = await axios.get(`${API_URL}/api/data/sensor/${selectedSensor}?range=${timeRange}&fromNow=${fromNow}`);
      setRawGraphData(r.data);
      
      // Fetch anomaly readings for all nodes in parallel
      const nodes = Array.from(new Set(r.data.flatMap(item => Object.keys(item).filter(key => key !== 'timestamp'))));
      const anomalyPromises = nodes.map(nodeId => 
        axios.get(`${API_URL}/api/nodes/${nodeId}/anomalies?sensor=${selectedSensor}&range=${timeRange}&fromNow=${fromNow}`)
          .then(res => res.data.map(a => ({ ...a, nodeId })))
          .catch(() => [])  // Silently fail individual node anomaly fetches
      );
      const anomalyResults = await Promise.all(anomalyPromises);
      setAnomalyReadings(anomalyResults.flat());
    } catch (e) { setGraphError(`Fetch error.`); console.error(e); } 
    finally { if (!isPoll) setGraphLoading(false); }
  }, [selectedSensor, timeRange, fromNow]);

  // =========================================================================
  // EFFECTS - Data fetching and polling
  // =========================================================================

  // Initial node load on component mount
  useEffect(() => { setLoading(true); fetchNodes().finally(() => setLoading(false)); }, [fetchNodes]);

  // Auto-polling: Refresh data every 10 seconds
  useEffect(() => { 
    const poll=10000; 
    const id=setInterval(()=>{ fetchNodes(); setGraphRefetchTrigger(p => p + 1); }, poll); 
    return () => clearInterval(id);  // Cleanup on unmount
  }, [fetchNodes]);

  // Fetch graph data when sensor, time range, or fromNow changes
  useEffect(() => { fetchGraphData(false); }, [selectedSensor, timeRange, fromNow, fetchGraphData]);

  // Fetch graph data on poll trigger (background refresh)
  useEffect(() => { if (graphRefetchTrigger > 0) { fetchGraphData(true); } }, [graphRefetchTrigger, fetchGraphData]);

  /** Fetch anomaly statistics and detection status */
  const fetchAnomalyStats = useCallback(async () => {
    try {
      // Fetch both stats and status endpoints in parallel
      const [statsRes, statusRes] = await Promise.all([
        axios.get(`${API_URL}/api/anomaly/stats`),
        axios.get(`${API_URL}/api/anomaly/status`)
      ]);
      setAnomalyStats({
        ...statsRes.data,
        ...statusRes.data
      });
      // Sync running state with server
      setAnomalyRunning(statusRes.data.detection_running);
    } catch (e) {
      console.error("Failed to fetch anomaly stats:", e);
    }
  }, []);

  // Run anomaly detection
  const runAnomalyDetection = async (reprocessAll = false, useThreshold = false) => {
    setAnomalyRunning(true);
    setAnomalyMessage(null);
    try {
      const r = await axios.post(`${API_URL}/api/anomaly/detect?reprocess_all=${reprocessAll}&use_threshold=${useThreshold}`);
      setAnomalyMessage({
        type: r.data.success ? 'success' : 'error',
        text: `${r.data.message}. Processed: ${r.data.processed || 0}, Anomalies: ${r.data.anomalies_found || 0}`
      });
      // Refresh stats after detection
      fetchAnomalyStats();
      // Refresh graph to show new anomalies
      setGraphRefetchTrigger(p => p + 1);
    } catch (e) {
      setAnomalyMessage({
        type: 'error',
        text: e.response?.data?.detail || 'Failed to run anomaly detection'
      });
    } finally {
      setAnomalyRunning(false);
    }
  };

  // Fetch anomaly stats on mount and poll periodically
  useEffect(() => { 
    fetchAnomalyStats(); 
    const interval = setInterval(fetchAnomalyStats, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [fetchAnomalyStats]);

  // Memoized calculations
  const allSensors = useMemo(() => Array.from(new Set(nodes.flatMap(n=>n.sensors))).sort(), [nodes]);
  const summaryStats = useMemo(() => ({totalNodes:nodes.length, uniqueSensorTypes:allSensors.length, totalSensorInstances:nodes.reduce((a,n)=>a+n.sensors.length,0)}), [nodes, allSensors]);
  
  // Effect for initial random sensor selection
  useEffect(() => { if(allSensors.length>0 && selectedSensor===''){setSelectedSensor(allSensors[Math.floor(Math.random()*allSensors.length)]);} }, [allSensors, selectedSensor]);
  
  const handleSensorChange = (e) => {setSelectedSensor(e.target.value); setLineColors(shuffleColors());};

  // Calculate the date range to display based on selected time range and data
  const dateRangeDisplay = useMemo(() => {
    const formatDate = (date) => {
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    };

    if (timeRange === 'all') {
      if (rawGraphData.length === 0) return 'All Time';
      const firstDate = new Date(rawGraphData[0].timestamp);
      const lastDate = new Date(rawGraphData[rawGraphData.length - 1].timestamp);
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
  }, [timeRange, rawGraphData]);

  // Calculate latest data here in the parent
  const latestNodeData = useMemo(() => {
    if (!rawGraphData || rawGraphData.length === 0) return [];
    const nodeKeys = Array.from(new Set(rawGraphData.flatMap(item => Object.keys(item).filter(key => key !== 'timestamp'))));
    const latestData = nodeKeys.map(nodeId => {
      const lastEntry = [...rawGraphData].reverse().find(item => item[nodeId] != null);
      if (lastEntry) return { nodeId: nodeId, value: lastEntry[nodeId], timestamp: new Date(lastEntry.timestamp) };
      return null;
    }).filter(Boolean);
    latestData.sort((a, b) => b.timestamp - a.timestamp);
    return latestData;
  }, [rawGraphData]);


  if(loading) return <div>Loading nodes...</div>; // Only show initial page load

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Dashboard</h1>
      {error && !loading && <div className="mb-4 text-red-600 text-sm font-semibold">{error} Check console.</div>}
      
      {/* 1. Summary Stats Section (Unchanged) */}
      <section className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* MODIFIED: LuHardDrive is not imported, so using LuDatabaseZap as a placeholder */}
        <SummaryStatCard title="Total Nodes" value={summaryStats.totalNodes} icon={<LuDatabaseZap />} />
        <SummaryStatCard title="Unique Sensor Types" value={summaryStats.uniqueSensorTypes} icon={<LuTags />} />
        <SummaryStatCard title="Total Sensor Instances" value={summaryStats.totalSensorInstances} icon={<LuDatabaseZap />} />
      </section>

      {/* Anomaly Detection Section */}
      <section className="mb-8 p-6 bg-white rounded-lg shadow-md">
        <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
          <div className="flex items-center gap-2">
            <LuTriangleAlert className="text-2xl text-orange-500" />
            <h2 className="text-2xl font-semibold">Anomaly Detection</h2>
            {anomalyStats?.models_loaded && anomalyStats.models_loaded.length > 0 && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">ML Active</span>
            )}
            {anomalyStats?.detection_running && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full flex items-center gap-1">
                <LuRefreshCw className="animate-spin w-3 h-3" /> Processing...
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Show unprocessed count if any */}
            {anomalyStats?.unprocessed > 0 && (
              <span className="text-sm text-gray-500">
                {anomalyStats.unprocessed} untagged
                {anomalyStats.will_auto_detect && (
                  <span className="text-blue-600 ml-1">(auto-detect pending)</span>
                )}
              </span>
            )}
            <button
              onClick={() => setShowAnomalies(!showAnomalies)}
              disabled={!anomalyStats?.with_anomalies}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
                !anomalyStats?.with_anomalies
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : showAnomalies
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-orange-500 text-white hover:bg-orange-600'
              }`}
            >
              {showAnomalies ? <LuEyeOff /> : <LuEye />}
              {showAnomalies ? 'Hide Anomalies' : 'Show Anomalies'}
            </button>
            <button
              onClick={() => runAnomalyDetection(false, false)}
              disabled={anomalyRunning || anomalyStats?.unprocessed === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
                anomalyRunning || anomalyStats?.unprocessed === 0
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed' 
                  : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              {anomalyRunning ? <LuRefreshCw className="animate-spin" /> : <LuPlay />}
              {anomalyRunning ? 'Running...' : 'Detect New'}
            </button>
            <button
              onClick={() => runAnomalyDetection(true, false)}
              disabled={anomalyRunning}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
                anomalyRunning
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed' 
                  : 'bg-purple-500 text-white hover:bg-purple-600'
              }`}
              title="Reprocess all readings with anomaly detection"
            >
              {anomalyRunning ? <LuRefreshCw className="animate-spin" /> : <LuRefreshCw />}
              Reprocess All
            </button>
          </div>
        </div>

        {/* Status Message */}
        {anomalyMessage && (
          <div className={`mb-4 p-3 rounded-md text-sm ${
            anomalyMessage.type === 'success' 
              ? 'bg-green-100 text-green-800 border border-green-300' 
              : 'bg-red-100 text-red-800 border border-red-300'
          }`}>
            {anomalyMessage.text}
          </div>
        )}

        {/* Stats Display */}
        {anomalyStats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-500">Total Readings</div>
              <div className="text-2xl font-bold">{anomalyStats.total_readings?.toLocaleString()}</div>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-500">Processed</div>
              <div className="text-2xl font-bold">
                {anomalyStats.processed?.toLocaleString()}
                <span className="text-sm text-gray-500 ml-1">({anomalyStats.processed_percent}%)</span>
              </div>
            </div>
            <div className={`p-4 rounded-lg ${anomalyStats.unprocessed > 0 ? 'bg-yellow-50' : 'bg-gray-50'}`}>
              <div className={`text-sm ${anomalyStats.unprocessed > 0 ? 'text-yellow-600' : 'text-gray-500'}`}>Unprocessed</div>
              <div className={`text-2xl font-bold ${anomalyStats.unprocessed > 0 ? 'text-yellow-600' : ''}`}>
                {anomalyStats.unprocessed?.toLocaleString() || 0}
              </div>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg">
              <div className="text-sm text-orange-600">Anomalies Found</div>
              <div className="text-2xl font-bold text-orange-600">{anomalyStats.with_anomalies?.toLocaleString()}</div>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg">
              <div className="text-sm text-orange-600">Anomaly Rate</div>
              <div className="text-2xl font-bold text-orange-600">{anomalyStats.anomaly_rate}%</div>
            </div>
          </div>
        )}

        {/* Per-sensor breakdown */}
        {anomalyStats?.by_sensor && Object.keys(anomalyStats.by_sensor).length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-medium text-gray-600 mb-2">Anomalies by Sensor:</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(anomalyStats.by_sensor).map(([sensor, count]) => (
                <span key={sensor} className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm">
                  {sensor}: {count}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* --- 2. MERGED Sensor Summary Section --- */}
      <section className="mb-12 p-6 bg-white rounded-lg shadow-md">
        
        {/* Header & Dropdowns */}
        <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
          <h2 className="text-2xl font-semibold">Sensor Summary</h2>
          <div className="flex items-center gap-4">
            <select value={selectedSensor} onChange={handleSensorChange} className="p-2 border rounded-md bg-gray-50"><option value="" disabled>{allSensors.length>0?'-- Sensor --':'Loading...'}</option>{allSensors.map((s)=>(<option key={s} value={s}>{s}</option>))}</select>
            <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="p-2 border rounded-md bg-gray-50">{rangeOptions.map((o)=>(<option key={o.value} value={o.value}>{o.label}</option>))}</select>
            <button
              onClick={() => setFromNow(!fromNow)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${fromNow ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-green-100 text-green-700 border border-green-300'}`}
              title={fromNow ? 'Currently showing data relative to current time' : 'Currently showing data relative to latest data point'}
            >
              {fromNow ? 'From Now' : 'From Data'}
            </button>
            {dateRangeDisplay && (
              <span className="text-sm text-gray-600 font-medium bg-gray-100 px-3 py-2 rounded-md">
                {dateRangeDisplay}
              </span>
            )}
          </div>
        </div>

        {/* --- Latest Readings (MOVED INSIDE) --- */}
        {selectedSensor && (
          <div className="mt-6 mb-8"> 
            <h3 className="text-lg font-semibold text-gray-700 mb-3">
              Latest Readings: <span className="capitalize text-blue-600">{selectedSensor}</span>
            </h3>
            {graphLoading && latestNodeData.length === 0 ? (
              <div className="p-4 bg-gray-50 rounded-lg text-gray-500 text-sm">Loading latest data...</div>
            ) : latestNodeData.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {latestNodeData.map(data => (
                  <LatestDataCard
                    key={data.nodeId}
                    nodeId={data.nodeId}
                    value={data.value}
                    timestamp={data.timestamp}
                    sensorKey={selectedSensor}
                  />
                ))}
              </div>
            ) : (
              <div className="p-4 bg-gray-50 rounded-lg text-gray-500 text-sm">
                No recent data found for this sensor.
              </div>
            )}
          </div>
        )}

        {/* --- Sensor History (Graph) --- */}
        {selectedSensor && (
          <h3 className="text-lg font-semibold text-gray-700 mb-3">
            Sensor History
          </h3>
        )}
        <SummaryGraph 
          selectedSensor={selectedSensor}
          nodeColors={lineColors} 
          rawGraphData={rawGraphData}
          anomalyReadings={anomalyReadings}
          showAnomalies={showAnomalies}
          isLoading={graphLoading}
          error={graphError}
        />
      </section>
    </div>
  );
};

export default Dashboard;