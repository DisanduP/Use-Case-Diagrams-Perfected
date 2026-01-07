#!/usr/bin/env node

const fs = require('fs');
const { program } = require('commander');
const dagre = require('dagre');
const { create } = require('xmlbuilder2');

program
  .version('1.2.0')
  .description('Convert PlantUML Use Case diagram to Draw.io XML')
  .argument('<inputFile>', 'Path to the .puml file')
  .option('-o, --output <path>', 'Path to output file', 'output.drawio')
  .action((inputFile, options) => {
    convertPumlToDrawio(inputFile, options.output);
  });

program.parse(process.argv);

function convertPumlToDrawio(inputPath, outputPath) {
  try {
    const pumlContent = fs.readFileSync(inputPath, 'utf-8');
    const graphData = parsePuml(pumlContent);
    
    if (graphData.nodes.length === 0) {
      console.error("❌ Error: No nodes found. Check your PlantUML syntax.");
      return;
    }

    const layout = calculateLayout(graphData);
    const xml = generateDrawioXml(layout);

    fs.writeFileSync(outputPath, xml);
    console.log(`✅ Success! Converted to ${outputPath}`);
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

function parsePuml(content) {
  const lines = content.split('\n');
  const nodes = []; 
  const edges = []; 
  const idMap = {}; 

  lines.forEach(line => {
    line = line.trim();
    if (!line || line.startsWith("'") || line.startsWith("@startuml") || line.startsWith("@enduml")) return;

    // Improved Regex
    const actorMatch = line.match(/actor\s+(?:"([^"]+)"|(\w+))(?:\s+as\s+(\w+))?/i);
    const usecaseMatch = line.match(/usecase\s+(?:"([^"]+)"|(\w+))(?:\s+as\s+(\w+))?/i);
    const shorthandActorMatch = line.match(/^:([^:]+):$/);
    const shorthandUsecaseMatch = line.match(/^\(([^)]+)\)$/);
    const edgeMatch = line.match(/([^\s\-<>\.]+)\s*(?:[-.]+(?:>)?|<?[-.]+)\s*([^\s\-<>\.]+)/);

    if (actorMatch) {
      const label = actorMatch[1] || actorMatch[2];
      const id = actorMatch[3] || label.replace(/\s+/g, '_');
      addNode(nodes, idMap, id, label, 'actor');
    } else if (usecaseMatch) {
      const label = usecaseMatch[1] || usecaseMatch[2];
      const id = usecaseMatch[3] || label.replace(/\s+/g, '_');
      addNode(nodes, idMap, id, label, 'usecase');
    } else if (shorthandActorMatch) {
      const label = shorthandActorMatch[1];
      addNode(nodes, idMap, label.replace(/\s+/g, '_'), label, 'actor');
    } else if (shorthandUsecaseMatch) {
      const label = shorthandUsecaseMatch[1];
      addNode(nodes, idMap, label.replace(/\s+/g, '_'), label, 'usecase');
    } else if (edgeMatch) {
      let source = edgeMatch[1].replace(/[:()]/g, '');
      let target = edgeMatch[2].replace(/[:()]/g, '');
      edges.push({ source, target });
    }
  });

  return { nodes, edges };
}

function addNode(nodes, idMap, id, label, type) {
    if (!idMap[id]) {
        nodes.push({ 
            id, 
            label, 
            type, 
            width: type === 'actor' ? 40 : 120, 
            height: type === 'actor' ? 80 : 60 
        });
        idMap[id] = id;
        idMap[label] = id;
    }
}

function calculateLayout(graphData) {
  const g = new dagre.graphlib.Graph();
  // Rankdir LR ensures Actors are left and Use Cases are right
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 150 }); 
  g.setDefaultEdgeLabel(() => ({}));

  graphData.nodes.forEach(node => {
    g.setNode(node.id, { label: node.label, width: node.width, height: node.height, type: node.type });
  });

  graphData.edges.forEach(edge => {
    // Resolve IDs in case labels were used in the edge definition
    const s = graphData.nodes.find(n => n.id === edge.source || n.label === edge.source)?.id;
    const t = graphData.nodes.find(n => n.id === edge.target || n.label === edge.target)?.id;
    if (s && t) g.setEdge(s, t);
  });

  dagre.layout(g);

  const layoutNodes = [];
  const layoutEdges = [];

  g.nodes().forEach(v => {
    const node = g.node(v);
    layoutNodes.push({
      id: v,
      label: node.label,
      type: node.type,
      x: node.x - (node.width / 2),
      y: node.y - (node.height / 2),
      width: node.width,
      height: node.height
    });
  });

  g.edges().forEach(e => {
    layoutEdges.push({ source: e.v, target: e.w });
  });

  return { nodes: layoutNodes, edges: layoutEdges };
}

function generateDrawioXml(layout) {
  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('mxfile', { host: 'Electron', type: 'device' })
    .ele('diagram', { name: 'Page-1' })
    .ele('mxGraphModel', { dx: '1000', dy: '1000', grid: '1', gridSize: '10', guides: '1', tooltips: '1', connect: '1', arrows: '1', fold: '1', page: '1', pageScale: '1', pageWidth: '850', pageHeight: '1100' })
    .ele('root');

  root.ele('mxCell', { id: '0' });
  root.ele('mxCell', { id: '1', parent: '0' });

  layout.nodes.forEach(node => {
    let style = (node.type === 'actor') 
      ? 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;' 
      : 'ellipse;whiteSpace=wrap;html=1;';

    root.ele('mxCell', { id: node.id, value: node.label, style: style, parent: '1', vertex: '1' })
    .ele('mxGeometry', { x: Math.round(node.x), y: Math.round(node.y), width: node.width, height: node.height, as: 'geometry' });
  });

  layout.edges.forEach((edge, index) => {
    // entryX=0 means line hits the left side of the target (use case)
    // exitX=1 means line leaves the right side of the source (actor)
    const style = 'endArrow=none;html=1;rounded=0;exitX=1;exitY=0.5;entryX=0;entryY=0.5;';
    
    root.ele('mxCell', { id: `edge_${index}`, style: style, edge: '1', parent: '1', source: edge.source, target: edge.target })
    .ele('mxGeometry', { relative: '1', as: 'geometry' });
  });

  return root.end({ prettyPrint: true });
}