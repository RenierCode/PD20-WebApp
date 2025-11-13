// File: src/Dashboard.js

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
// MODIFIED: Removed LuHardDrive, LuTimer, Link
import { LuTags, LuDatabaseZap, LuSignal } from 'react-icons/lu';
// MODIFIED: Removed Link
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, TimeScale,
} from 'chart.js';
import 'chartjs-adapter-date-fns';

// Register Chart.js components
ChartJS.register( CategoryScale, LinearScale, PointElement, LineElement, TimeScale, Title, Tooltip, Legend );

const API_URL = 'http://127.0.0.1:8000';
const BRIGHT_COLORS = [ '#E6194B', '#3CB44B', '#0082C8', '#F58231', '#911EB4', '#46F0F0', '#F032E6', '#FFE119', ];
const shuffleColors = () => { const a=[...BRIGHT_COLORS]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };

// --- REMOVED: useStatusColor hook ---
// --- REMOVED: NodeCard component ---

// SummaryStatCard component (Unchanged)
const SummaryStatCard = ({ title, value, icon }) => ( <div className="bg-white p-6 rounded-lg shadow-md flex items-center gap-4"><div className="text-3xl text-blue-500">{icon}</div><div><div className="text-sm font-medium text-gray-500">{title}</div><div className="text-3xl font-bold">{value}</div></div></div> );


// --- LatestDataCard Component (Unchanged) ---
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


// --- SummaryGraph Component (Unchanged) ---
const SummaryGraph = ({ rawGraphData, nodeColors, isLoading, error, selectedSensor }) => {
  const [chartData, setChartData] = useState({ labels: [], datasets: [] });

  const transformDataForChartJS = useCallback((apiData, colors) => {
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
    return { labels, datasets };
  }, []);

  useEffect(() => {
    setChartData(transformDataForChartJS(rawGraphData, nodeColors));
  }, [rawGraphData, nodeColors, transformDataForChartJS]);
  
  const chartOptions = { responsive: true, maintainAspectRatio: false, interaction:{mode:'x',intersect:false}, plugins:{legend:{position:'top'},tooltip:{mode:'x',intersect:false}}, scales:{x:{type:'time',time:{displayFormats:{hour:'MMM d, h a',day:'MMM d',month:'MMM yyyy'},tooltipFormat:'PPp'},title:{display:true,text:'Timestamp'}},y:{title:{display:true,text:'Value'}}}, };
  
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


// --- Main Dashboard component (with polling) ---
const Dashboard = () => {
  const [nodes, setNodes] = useState([]); 
  const [loading, setLoading] = useState(true); 
  const [error, setError] = useState(null);
  const [selectedSensor, setSelectedSensor] = useState(''); 
  const [timeRange, setTimeRange] = useState('latest24h');
  const [lineColors, setLineColors] = useState(() => shuffleColors()); 
  const [graphRefetchTrigger, setGraphRefetchTrigger] = useState(0);

  const [rawGraphData, setRawGraphData] = useState([]);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState(null);

  const rangeOptions = [{value:'latest24h',label:'Latest 24h(Data)'},{value:'24h',label:'Last 24h(Now)'},{value:'1w',label:'Last 7d'},{value:'1m',label:'Last 30d'},{value:'all',label:'All Time'},];

  // Memoized function to fetch nodes
  const fetchNodes = useCallback(async () => { 
    try { const r = await axios.get(`${API_URL}/api/nodes`); setNodes(r.data); } 
    catch(e){ setError("Node poll error."); console.error("Poll:", e); } 
  }, []);

  // Memoized function to fetch graph data
  const fetchGraphData = useCallback(async (isPoll = false) => {
    if (!selectedSensor) { setRawGraphData([]); return; }
    if (!isPoll) setGraphLoading(true); 
    setGraphError(null);
    try {
      const r = await axios.get(`${API_URL}/api/data/sensor/${selectedSensor}?range=${timeRange}`);
      setRawGraphData(r.data);
    } catch (e) { setGraphError(`Fetch error.`); console.error(e); } 
    finally { if (!isPoll) setGraphLoading(false); }
  }, [selectedSensor, timeRange]);

  // Effect for initial node load
  useEffect(() => { setLoading(true); fetchNodes().finally(() => setLoading(false)); }, [fetchNodes]);

  // Effect for polling (triggers both fetches)
  useEffect(() => { 
    const poll=10000; 
    const id=setInterval(()=>{ fetchNodes(); setGraphRefetchTrigger(p => p + 1); }, poll); 
    return () => clearInterval(id); 
  }, [fetchNodes]);

  // Effect to fetch graph data on manual change (sensor, range)
  useEffect(() => { fetchGraphData(false); }, [selectedSensor, timeRange, fetchGraphData]);

  // Effect to fetch graph data on poll trigger
  useEffect(() => { if (graphRefetchTrigger > 0) { fetchGraphData(true); } }, [graphRefetchTrigger, fetchGraphData]);

  // Memoized calculations
  const allSensors = useMemo(() => Array.from(new Set(nodes.flatMap(n=>n.sensors))).sort(), [nodes]);
  const summaryStats = useMemo(() => ({totalNodes:nodes.length, uniqueSensorTypes:allSensors.length, totalSensorInstances:nodes.reduce((a,n)=>a+n.sensors.length,0)}), [nodes, allSensors]);
  
  // Effect for initial random sensor selection
  useEffect(() => { if(allSensors.length>0 && selectedSensor===''){setSelectedSensor(allSensors[Math.floor(Math.random()*allSensors.length)]);} }, [allSensors, selectedSensor]);
  
  const handleSensorChange = (e) => {setSelectedSensor(e.target.value); setLineColors(shuffleColors());};

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

      {/* --- 2. MERGED Sensor Summary Section --- */}
      <section className="mb-12 p-6 bg-white rounded-lg shadow-md">
        
        {/* Header & Dropdowns */}
        <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
          <h2 className="text-2xl font-semibold">Sensor Summary</h2>
          <div className="flex items-center gap-4">
            <select value={selectedSensor} onChange={handleSensorChange} className="p-2 border rounded-md bg-gray-50"><option value="" disabled>{allSensors.length>0?'-- Sensor --':'Loading...'}</option>{allSensors.map((s)=>(<option key={s} value={s}>{s}</option>))}</select>
            <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="p-2 border rounded-md bg-gray-50">{rangeOptions.map((o)=>(<option key={o.value} value={o.value}>{o.label}</option>))}</select>
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
          isLoading={graphLoading}
          error={graphError}
        />
      </section>

      {/* --- 3. Node Overview Section (REMOVED) --- */}
      
    </div>
  );
};

export default Dashboard;