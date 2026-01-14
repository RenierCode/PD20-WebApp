// File: src/Reports.js

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { jsPDF } from 'jspdf';
import Papa from 'papaparse';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend,
} from 'chart.js';
import 'chartjs-adapter-date-fns'; // Import adapter

// Register Chart.js components
ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend
);

const API_URL = 'http://127.0.0.1:8000';

/**
 * Converts an ISO 8601 string (or Date object) into the format
 * required by <input type="datetime-local"> (YYYY-MM-DDTHH:MM)
 * in the *user's local timezone*.
 */
const formatDateTimeForInput = (dateString) => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    // Pad numbers to 2 digits (e.g., 9 -> "09")
    const pad = (num) => num.toString().padStart(2, '0');
    
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1); // getMonth() is 0-indexed
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    
    // Returns format YYYY-MM-DDTHH:MM
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch (e) {
    console.error("Failed to format date:", dateString, e);
    return '';
  }
};


const Reports = () => {
  const [nodes, setNodes] = useState([]);
  const [selectedNode, setSelectedNode] = useState('');
  
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  // State for the node's valid time range
  const [nodeTimeRange, setNodeTimeRange] = useState({ min: '', max: '' });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [chartConfigs, setChartConfigs] = useState([]);
  const chartRefs = useRef([]); // To hold refs to the chart instances

  // 1. Fetch all nodes for the dropdown
  useEffect(() => {
    const fetchNodes = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/nodes`);
        setNodes(response.data);
      } catch (err) { console.error("Failed to fetch nodes", err); }
    };
    fetchNodes();
  }, []);

  // 2. Effect to fetch the time range when a node is selected
  useEffect(() => {
    if (!selectedNode) {
      setNodeTimeRange({ min: '', max: '' });
      setStartTime('');
      setEndTime('');
      return;
    }

    const fetchTimeRange = async () => {
      setError(null); // Clear previous errors
      try {
        const response = await axios.get(`${API_URL}/api/nodes/${selectedNode}/time_range`);
        const { firstSeen, lastSeen } = response.data;

        if (firstSeen && lastSeen) {
          const minDate = formatDateTimeForInput(firstSeen);
          const maxDate = formatDateTimeForInput(lastSeen);
          
          setNodeTimeRange({ min: minDate, max: maxDate });
          // Auto-fill the start/end times to the node's full range
          setStartTime(minDate);
          setEndTime(maxDate);
        } else {
          setError("This node has no data to report.");
          setNodeTimeRange({ min: '', max: '' });
        }
      } catch (err) {
        console.error("Failed to fetch time range", err);
        setError("Could not fetch data range for this node.");
        setNodeTimeRange({ min: '', max: '' });
      }
    };

    fetchTimeRange();
  }, [selectedNode]); // This effect runs when selectedNode changes


  // 3. Helper function to fetch data for the selected node & time range
  const fetchNodeData = async (nodeId, start, end) => {
    if (!nodeId) { setError('Please select a node first.'); return null; }
    setLoading(true); setError(null);
    
    const params = new URLSearchParams();
    
    // --- TIMEZONE FIX ---
    // Append 'Z' to treat the local datetime string as UTC
    if (start) params.append('start_time', start + 'Z');
    if (end) params.append('end_time', end + 'Z');
    // --- END FIX ---
    
    const query = params.toString();
    const requestUrl = `${API_URL}/api/nodes/${nodeId}/readings?${query}`;

    try {
      const response = await axios.get(requestUrl);
      if (response.data.length === 0) {
         setError("No data found for this node and time range.");
         setLoading(false); // Make sure to stop loading
         return null;
      }
      return response.data;
    } catch (err) { 
      setError('Failed to fetch data for this node.'); 
      console.error(err); 
      setLoading(false); // Make sure to stop loading on error
      return null; 
    }
  };

  // Fetch the next reading at or after `time` (used to include one more data forward than end time)
  const getNextReading = async (nodeId, time) => {
    if (!nodeId || !time) return null;
    try {
      const params = new URLSearchParams();
      params.append('start_time', time + 'Z');
      const resp = await axios.get(`${API_URL}/api/nodes/${nodeId}/readings?${params.toString()}`);
      const arr = resp.data || [];
      if (arr.length === 0) return null;
      const endDate = new Date(time);
      // Return the first reading strictly after the end time, or if none, null
      for (let r of arr) {
        const t = new Date(r.timestamp);
        if (t > endDate) return r;
      }
      return null;
    } catch (err) {
      console.error('Failed to fetch next reading', err);
      return null;
    }
  };

  // 4. Handle CSV Generation
  const handleGenerateCSV = async () => {
    const data = await fetchNodeData(selectedNode, startTime, endTime);
    if (!data) { // fetchNodeData returns null on error or no data
      setLoading(false);
      return;
    }
    // Include one additional reading after endTime when available
    if (endTime) {
      const next = await getNextReading(selectedNode, endTime);
      if (next) data.push(next);
    }

    const flatData = data.map(r => ({
      timestamp: new Date(r.timestamp).toLocaleString(),
      // Flatten sensor data fields
      ...r.sensorData,
      // Include anomalies as a string (join array) or fallback to legacy boolean
      anomalies: Array.isArray(r.anomalies) ? r.anomalies.join(';') : (r.anomaly ? 'ALL_SENSORS' : '')
    }));
    const csv = Papa.unparse(flatData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    // Include start/end in filename (sanitize colons)
    const safe = (s) => s ? s.replace(/:/g, '-') : '';
    const sPart = startTime ? safe(startTime) : 'start';
    const ePart = endTime ? safe(endTime) : 'end';
    link.setAttribute('download', `${selectedNode}_${sPart}_${ePart}_data.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setLoading(false);
  };

  // 5. Handle PDF Generation (Step 1: Fetch and prepare)
  const handleGeneratePDF = async () => {
    const data = await fetchNodeData(selectedNode, startTime, endTime);
    if (!data) { // fetchNodeData returns null on error or no data
      setLoading(false);
      return;
    }
    // Include one additional reading after endTime when available
    if (endTime) {
      const next = await getNextReading(selectedNode, endTime);
      if (next) data.push(next);
    }
    // Robustly find all sensor keys
    const sensorKeys = Array.from(new Set(data.flatMap(d => d.sensorData ? Object.keys(d.sensorData) : [])));
    const labels = data.map(d => new Date(d.timestamp).toLocaleString()); // Use readable labels

    // Build chart configs with per-point anomaly highlighting and counts
    const configs = sensorKeys.map(key => {
      const values = data.map(d => d.sensorData ? (d.sensorData[key] ?? null) : null);
      const mask = data.map(d => Array.isArray(d.anomalies) ? d.anomalies.includes(key) : !!d.anomaly);
      const pointBackgroundColor = mask.map(m => m ? 'rgba(220,53,69,0.9)' : 'rgba(54,162,235,0.7)');
      const pointRadius = mask.map(m => m ? 4 : 1);
      const anomalyCount = mask.filter(Boolean).length;

      return {
        sensorName: key,
        anomalyCount,
        data: {
          labels,
          datasets: [{
            label: key,
            data: values,
            borderColor: `rgb(${Math.floor(Math.random()*200)}, ${Math.floor(Math.random()*200)}, ${Math.floor(Math.random()*200)})`,
            tension: 0.1,
            spanGaps: true,
            pointBackgroundColor,
            pointRadius,
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'top' }, title: { display: true, text: `Sensor: ${key.toUpperCase()}` }, },
          animation: { duration: 0 },
        },
      };
    });

    chartRefs.current = new Array(configs.length);
    setChartConfigs(configs); // This triggers the useEffect below
  };

  // 6. Handle PDF Generation (Step 2: Create PDF after charts render)
  useEffect(() => {
    if (chartConfigs.length === 0 || !loading) return; // Only run if we are loading and have configs
    
    const timer = setTimeout(() => {
      try {
        const doc = new jsPDF();
        doc.text(`Sensor Report for ${selectedNode}`, 14, 15);
        if (startTime) doc.text(`Start: ${new Date(startTime).toLocaleString()}`, 14, 22);
        if (endTime) doc.text(`End: ${new Date(endTime).toLocaleString()}`, 14, 29);
        let yPos = 40; // Start lower

        // For each chart, print the sensor name + anomaly count, then the chart image
        chartRefs.current.forEach((chartInstance, idx) => {
          const cfg = chartConfigs[idx];
          if (cfg) {
            const titleLine = `${cfg.sensorName.toUpperCase()} — Anomalies: ${cfg.anomalyCount}`;
            if (yPos + 8 > 280) { doc.addPage(); yPos = 15; }
            doc.setFontSize(11);
            doc.text(titleLine, 14, yPos);
            yPos += 8;
          }

          if (chartInstance) { // Check if ref is set
            const imgData = chartInstance.toBase64Image();
            if (yPos + 100 > 280) { doc.addPage(); yPos = 15; } // Page break
            doc.addImage(imgData, 'PNG', 10, yPos, 190, 100); // Add chart image
            yPos += 110;
          }
        });
      // Include start/end in filename (sanitize colons)
      const safe = (s) => s ? s.replace(/:/g, '-') : '';
      const sPart = startTime ? safe(startTime) : 'start';
      const ePart = endTime ? safe(endTime) : 'end';
      doc.save(`${selectedNode}_${sPart}_${ePart}_report.pdf`);
      } catch (err) { console.error(err); setError("Failed to generate PDF."); }
      
      // Cleanup
      setLoading(false); 
      setChartConfigs([]); 
      chartRefs.current = [];
    }, 500); // 500ms delay to ensure canvas is rendered
    
    return () => clearTimeout(timer); // Cleanup timer
  }, [chartConfigs, loading, selectedNode, startTime, endTime]);

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Report Generation</h1>
        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex flex-col md:flex-row gap-4 mb-4">
          
            {/* Node Selector */}
            <div className="md:flex-[2]">
              <label htmlFor="node-select" className="block text-sm font-medium text-gray-700 mb-1">
                Select Node
              </label>
              <select
                id="node-select" value={selectedNode}
                onChange={(e) => { setSelectedNode(e.target.value); setError(null); setStartTime(''); setEndTime(''); }}
                className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="">-- Please choose a node --</option>
                {nodes.map(node => ( <option key={node.nodeId} value={node.nodeId}>{node.nodeId}</option> ))}
              </select>
            </div>

            {/* Start Time Selector */}
            <div className="flex-1">
              <label htmlFor="start-time" className="block text-sm font-medium text-gray-700 mb-1">
                Start Time
              </label>
              <input
                type="datetime-local" id="start-time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                min={nodeTimeRange.min}
                max={nodeTimeRange.max || formatDateTimeForInput(new Date())}
                disabled={!selectedNode}
                className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>

            {/* End Time Selector */}
            <div className="flex-1">
              <label htmlFor="end-time" className="block text-sm font-medium text-gray-700 mb-1">
                End Time
              </label>
              <input
                type="datetime-local" id="end-time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                min={nodeTimeRange.min}
                max={nodeTimeRange.max || formatDateTimeForInput(new Date())}
                disabled={!selectedNode}
                className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        
          {/* Buttons and Messages */}
          <div className="flex flex-wrap items-center gap-4">
            <button onClick={handleGenerateCSV} disabled={loading || !selectedNode} className="px-4 py-2 bg-green-600 text-white rounded-md font-semibold hover:bg-green-700 transition-colors disabled:bg-gray-400">
              {loading ? 'Working...' : 'Generate CSV'}
            </button>
            <button onClick={handleGeneratePDF} disabled={loading || !selectedNode} className="px-4 py-2 bg-red-600 text-white rounded-md font-semibold hover:bg-red-700 transition-colors disabled:bg-gray-400">
              {loading ? 'Working...' : 'Generate PDF'}
            </button>
            {loading && <div className="text-blue-600">Generating report...</div>}
            {error && <div className="text-red-600">{error}</div>}
          </div>
        </div>
        
      {/* Hidden Chart Renderer */}
      <div className="absolute -left-[9999px] w-[800px]">
        {chartConfigs.map((config, index) => (
          <Line key={index} ref={(el) => (chartRefs.current[index] = el)} data={config.data} options={config.options} />
        ))}
      </div>
    </div>
  );
};

export default Reports;