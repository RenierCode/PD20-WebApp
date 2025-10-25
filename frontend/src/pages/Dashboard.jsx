// File: src/Dashboard.js

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { LuHardDrive, LuTimer, LuTags, LuDatabaseZap } from 'react-icons/lu';
import { Link } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
} from 'chart.js'; // Ensure no trailing comma here
import 'chartjs-adapter-date-fns';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  TimeScale,
  Title,
  Tooltip,
  Legend
);

const API_URL = 'http://127.0.0.1:8000';
const BRIGHT_COLORS = [
  '#E6194B', '#3CB44B', '#0082C8', '#F58231',
  '#911EB4', '#46F0F0', '#F032E6', '#FFE119',
];

const shuffleColors = () => {
  const array = [...BRIGHT_COLORS];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

const useStatusColor = (status) =>
  status === 'Active'
    ? 'bg-[var(--status-active)]'
    : 'bg-[var(--status-inactive)]';

const NodeCard = ({ node }) => {
  const statusColorClass = useStatusColor(node.status);
  return (
    <div className="bg-white rounded-lg shadow-md p-6 transition-all transform hover:-translate-y-1 hover:shadow-lg">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <LuHardDrive /> {node.nodeId}
        </h3>
        <div
          className={`w-3 h-3 rounded-full ${statusColorClass}`}
          title={node.status}
        ></div>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {node.sensors.map((sensor) => (
          <span
            key={sensor}
            className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium"
          >
            {sensor}
          </span>
        ))}
      </div>
      <div className="text-sm text-gray-500 flex items-center gap-2">
        <LuTimer />
        Last seen:{' '}
        {node.lastSeen ? new Date(node.lastSeen).toLocaleString() : 'Never'}
      </div>
    </div>
  );
};

const SummaryStatCard = ({ title, value, icon }) => (
  <div className="bg-white p-6 rounded-lg shadow-md flex items-center gap-4">
    <div className="text-3xl text-blue-500">{icon}</div>
    <div>
      <div className="text-sm font-medium text-gray-500">{title}</div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  </div>
);

// --- SummaryGraph Component ---
const transformDataForChartJS = (apiData, nodeColors) => {
  if (!apiData || apiData.length === 0) return { labels: [], datasets: [] };
  const nodeKeys = Object.keys(apiData[0]).filter((key) => key !== 'timestamp');
  const labels = apiData.map((item) => item.timestamp);
  const datasets = nodeKeys.map((nodeId, index) => ({
    label: nodeId,
    data: apiData.map((item) => item[nodeId] ?? null),
    borderColor: nodeColors[index % nodeColors.length],
    backgroundColor: `${nodeColors[index % nodeColors.length]}80`,
    fill: false,
    tension: 0.1,
  }));
  return { labels, datasets };
};

const SummaryGraph = ({ selectedSensor, timeRange, nodeColors, triggerRefetch }) => {
  const [graphData, setGraphData] = useState({ labels: [], datasets: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchGraphData = useCallback(async () => {
    if (!selectedSensor) {
      setGraphData({ labels: [], datasets: [] });
      return;
    }
    // Don't set loading true here for polling to avoid flash
    setError(null);
    try {
      const response = await axios.get(
        `${API_URL}/api/data/sensor/${selectedSensor}?range=${timeRange}`
      );
      setGraphData(transformDataForChartJS(response.data, nodeColors));
    } catch (err) {
      setError(`Failed data fetch.`);
      console.error(err);
    } finally {
      setLoading(false); // Ensure loading is false after fetch/refetch
    }
  }, [selectedSensor, timeRange, nodeColors]);

  useEffect(() => {
    // Only set loading true if it's not a background poll (i.e., sensor/range changed)
    // We check this by seeing if graphData is currently empty
    if (graphData.datasets.length === 0 && selectedSensor) {
      setLoading(true);
    }
    fetchGraphData();
  }, [fetchGraphData, triggerRefetch, selectedSensor, timeRange]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'x', intersect: false },
    plugins: {
      legend: { position: 'top' },
      tooltip: { mode: 'x', intersect: false },
    },
    scales: {
      x: {
        type: 'time', // Use the time scale
        time: {
          tooltipFormat: 'PPp', // Format for the hover tooltip

          // --- LET CHART.JS CHOOSE THE UNIT ---
          // DO NOT specify 'unit: 'hour'' or similar here.
          displayFormats: {
            hour: 'MMM d, h a', // How to format if it chooses 'hour'
            minute: 'h:mm a',
            day: 'MMM d',      // How to format if it chooses 'day'
            month: 'MMM yyyy'  // How to format if it chooses 'month'
          }
        },
        title: {
          display: true,
          text: 'Timestamp',
        },
        ticks: {
          autoSkip: true,      // Automatically hide ticks to prevent overlap
          // maxTicksLimit: 10,   // Optional: Limit ticks further if needed
          // --- ALLOW ROTATION ONLY IF NEEDED ---
          maxRotation: 45,     // Allow rotating up to 45 degrees
          minRotation: 0       // But prefer 0 degrees (horizontal)
        }
      },
      y: {
        title: {
          display: true,
          text: 'Value',
        },
      },
    },
  };

  if (!selectedSensor) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg">
        <p className="text-gray-500">Please select a sensor.</p>
      </div>
    );
  }

  // Show loading indicator only on the very first load
  if (loading && graphData.datasets.length === 0) {
    return <div>Loading graph data...</div>;
  }
  if (error) {
    return <div className="text-red-600 font-semibold">{error}</div>;
  }

  return (
    <div style={{ height: '400px' }}>
      <Line options={chartOptions} data={graphData} />
    </div>
  );
};

// --- Main Dashboard component ---
const Dashboard = () => {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true); // For initial load only
  const [error, setError] = useState(null);
  const [selectedSensor, setSelectedSensor] = useState('');
  const [timeRange, setTimeRange] = useState('latest24h');
  const [lineColors, setLineColors] = useState(() => shuffleColors());
  const [graphRefetchTrigger, setGraphRefetchTrigger] = useState(0);

  const rangeOptions = [
    { value: 'latest24h', label: 'Latest 24h (Data)' },
    { value: '24h', label: 'Last 24h (Now)' },
    { value: '1w', label: 'Last 7d' },
    { value: '1m', label: 'Last 30d' },
    { value: 'all', label: 'All Time' },
  ];

  // Callback to fetch node list (for polling)
  const fetchNodes = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/nodes`);
      setNodes(response.data);
      // Optionally clear error on successful poll
      // setError(null);
    } catch (err) {
      setError('Node list update failed.'); // Specific polling error
      console.error('Polling fetchNodes error:', err);
    }
  }, []); // Empty dependency array

  // Initial fetch effect
  useEffect(() => {
    setLoading(true); // Set initial loading
    fetchNodes().finally(() => setLoading(false)); // Clear initial loading after fetch
  }, [fetchNodes]); // Run once

  // Polling useEffect
  useEffect(() => {
    const pollInterval = 5000; // Poll every 5 seconds
    console.log(`Setting up polling: ${pollInterval / 1000}s`);

    const intervalId = setInterval(() => {
      console.log('Polling...');
      fetchNodes(); // Fetch nodes for status updates
      setGraphRefetchTrigger((prev) => prev + 1); // Trigger graph update
    }, pollInterval);

    // Cleanup function
    return () => {
      console.log('Clearing polling interval.');
      clearInterval(intervalId);
    };
  }, [fetchNodes]); // Dependency ensures interval restarts if fetchNodes changes

  const allSensors = useMemo(
    () => Array.from(new Set(nodes.flatMap((n) => n.sensors))).sort(),
    [nodes]
  );

  const summaryStats = useMemo(
    () => ({
      totalNodes: nodes.length,
      uniqueSensorTypes: allSensors.length,
      totalSensorInstances: nodes.reduce((a, n) => a + n.sensors.length, 0),
    }),
    [nodes, allSensors]
  );

  // Effect to set initial random sensor
  useEffect(() => {
    if (allSensors.length > 0 && selectedSensor === '') {
      setSelectedSensor(
        allSensors[Math.floor(Math.random() * allSensors.length)]
      );
    }
  }, [allSensors, selectedSensor]);

  const handleSensorChange = (e) => {
    setSelectedSensor(e.target.value);
    setLineColors(shuffleColors());
  };

  // Show initial loading screen
  if (loading) return <div>Loading node list...</div>;

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Dashboard</h1>
      {/* Show polling error discreetly */}
      {error && !loading && (
        <div className="mb-4 text-red-600 text-sm font-semibold">
          {error} Check console.
        </div>
      )}

      <section className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <SummaryStatCard
          title="Total Nodes"
          value={summaryStats.totalNodes}
          icon={<LuHardDrive />}
        />
        <SummaryStatCard
          title="Unique Sensor Types"
          value={summaryStats.uniqueSensorTypes}
          icon={<LuTags />}
        />
        <SummaryStatCard
          title="Total Sensor Instances"
          value={summaryStats.totalSensorInstances}
          icon={<LuDatabaseZap />}
        />
      </section>

      <section className="mb-12 p-6 bg-white rounded-lg shadow-md">
        <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
          <h2 className="text-2xl font-semibold">Sensor Summary</h2>
          <div className="flex items-center gap-4">
            <select
              value={selectedSensor}
              onChange={handleSensorChange}
              className="p-2 border rounded-md bg-gray-50"
            >
              <option value="" disabled>
                {allSensors.length > 0 ? '-- Sensor --' : 'Loading...'}
              </option>
              {allSensors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="p-2 border rounded-md bg-gray-50"
            >
              {rangeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <SummaryGraph
          selectedSensor={selectedSensor}
          timeRange={timeRange}
          nodeColors={lineColors}
          triggerRefetch={graphRefetchTrigger}
        />
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-6">Node Overview</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {nodes.map((n) => (
            <Link to={`/node/${n.nodeId}`} key={n.nodeId}>
              <NodeCard node={n} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Dashboard;