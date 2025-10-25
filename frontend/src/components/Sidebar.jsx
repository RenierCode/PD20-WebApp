import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LuLayoutDashboard, 
  LuNetwork, 
  LuMap, // <-- IMPORT MAP ICON
  LuFileText,
  LuChevronsLeft,
  LuChevronsRight 
} from 'react-icons/lu';

const NavItem = ({ to, icon, label, isOpen }) => (
  <NavLink 
    to={to} 
    className={({ isActive }) => 
      `flex items-center gap-3 px-4 py-3 rounded-md font-medium transition-colors
      ${isOpen ? '' : 'justify-center'}
      ${isActive 
        ? 'bg-blue-500 text-white' 
        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
      }`
    }
  >
    <div className="text-xl">{icon}</div>
    {isOpen && <span>{label}</span>}
  </NavLink>
);

const Sidebar = ({ isOpen, toggle, widthClass }) => {
  return (
    <aside 
      className={`fixed top-0 left-0 h-full bg-white border-r border-gray-200 
                  flex flex-col justify-between p-4 
                  transition-all duration-300 ease-in-out ${widthClass}`}
    >
      <div className="flex-grow">
        <h1 
          className={`font-bold text-2xl pb-6 border-b border-gray-200 pt-4
                      ${isOpen ? 'text-center' : 'text-center'}`}
        >
          {isOpen ? "ArgusV2" : "A"}
        </h1>
        
        <nav className="mt-6 flex flex-col gap-2">
          <NavItem to="/" icon={<LuLayoutDashboard />} label="Dashboard" isOpen={isOpen} />
          <NavItem to="/nodes" icon={<LuNetwork />} label="Nodes" isOpen={isOpen} />
          <NavItem to="/map" icon={<LuMap />} label="Map" isOpen={isOpen} /> {/* <-- ADD THIS LINE */}
          <NavItem to="/reports" icon={<LuFileText />} label="Report Generation" isOpen={isOpen} />
        </nav>
      </div>

      <button 
        onClick={toggle}
        className="flex items-center justify-center p-3 rounded-md text-lg 
                   text-gray-500 bg-gray-50 border border-gray-200 
                   hover:bg-blue-500 hover:text-white hover:border-blue-500
                   transition-all"
      >
        {isOpen ? <LuChevronsLeft /> : <LuChevronsRight />}
      </button>
    </aside>
  );
};

export default Sidebar;