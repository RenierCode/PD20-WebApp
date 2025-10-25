import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

// --- Leaflet Icon Fix ---
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;
// --- End Icon Fix ---

const API_URL = 'http://127.0.0.1:8000';

const MapPage = () => {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Set a default center for the map
  const mapCenter = [14.65, 121.05]; // Default center (e.g., Quezon City)

  const fetchNodes = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/api/nodes`);
      
      // Filter out nodes that don't have a location
      const nodesWithLocation = response.data.filter(node => node.location);
      
      setNodes(nodesWithLocation);
      setError(null);
    } catch (err) {
      setError("Failed to fetch nodes, or nodes have no location data.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodes();
  }, []);
  
  if (loading) return <div>Loading map and node data...</div>;
  if (error) return <div className="text-red-600 font-semibold">{error}</div>;

  return (
    <div>
      <h1 className="text-4xl font-bold mb-4">Node Map</h1>
      <p className="text-gray-600 mb-6">
        Displaying the last known location of all sensor nodes.
      </p>
      
      {/* Container for the map with Tailwind classes */}
      <div className="h-[70vh] w-full rounded-lg shadow-md overflow-hidden z-10">
        <MapContainer center={mapCenter} zoom={13} className="w-full h-full">
          
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          
          {/* Loop through nodes and create markers */}
          {nodes.map(node => (
            <Marker 
              key={node.nodeId} 
              position={[node.location.latitude, node.location.longitude]}
            >
              <Popup>
                {/* Popup content - styled with simple HTML and Tailwind */}
                <div className="w-[250px]">
                  <h3 className="font-bold text-lg mb-2">{node.nodeId}</h3>
                  <p><b>Status:</b> {node.status}</p>
                  <p><b>Sensors:</b> {node.sensors.join(', ')}</p>
                </div>
              </Popup>
            </Marker>
          ))}
          
        </MapContainer>
      </div>
    </div>
  );
};

export default MapPage;