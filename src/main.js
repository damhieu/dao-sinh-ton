import * as THREE from "three";

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x3a6ea5);
renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
console.log("three", THREE.REVISION);
