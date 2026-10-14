"use client";
import {useEffect,useRef} from "react";
export default function MapPicker({lat,lng,onPick}){
 const el=useRef(null), map=useRef(null), marker=useRef(null);
 useEffect(()=>{
  let cancelled=false;
  const load=()=>{if(cancelled||!el.current||!window.L)return; const L=window.L; map.current=L.map(el.current,{zoomControl:true}).setView([Number.isFinite(lat)?lat:51.1694,Number.isFinite(lng)?lng:71.4491],Number.isFinite(lat)&&Number.isFinite(lng)?16:12); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map.current); if(Number.isFinite(lat)&&Number.isFinite(lng)) marker.current=L.marker([lat,lng]).addTo(map.current); map.current.on("click",e=>{if(marker.current)marker.current.setLatLng(e.latlng);else marker.current=L.marker(e.latlng).addTo(map.current);onPick({lat:e.latlng.lat,lng:e.latlng.lng});});};
  if(window.L)load(); else {const s=document.createElement("script");s.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";s.onload=load;document.head.appendChild(s);}
  return()=>{cancelled=true;if(map.current){map.current.remove();map.current=null;}};
 },[]);
 return <div ref={el} className="map-picker"/>;
}
