import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import SensorsNode from './pages/SensorsNode';
import MapPage from './pages/MapPage'; // <-- IMPORT MAP PAGE
import Reports from './pages/Reports';
import NodeDetailPage from './pages/NodeDetailPage';

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const sidebarWidth = isSidebarOpen ? 'w-[250px]' : 'w-[80px]';
  const contentMargin = isSidebarOpen ? 'ml-[250px]' : 'ml-[80px]';

  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-blue-100 text-gray-800">
        <Sidebar 
          isOpen={isSidebarOpen} 
          toggle={toggleSidebar} 
          widthClass={sidebarWidth}
        />
        
        <main 
          className={`flex-grow p-8 transition-all duration-300 ease-in-out ${contentMargin} max-w-full`}
        >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/nodes" element={<SensorsNode />} />
            <Route path="/map" element={<MapPage />} /> {/* <-- ADD THIS ROUTE */}
            <Route path="/reports" element={<Reports />} />
            <Route path="/node/:nodeId" element={<NodeDetailPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;