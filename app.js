/**
 * Web Packet Tracer - Lightweight Web-Based Network Simulator
 * Inspired by Cisco Packet Tracer
 */

// Sound Synthesizer via Web Audio API
class AudioFX {
  constructor() {
    this.ctx = null;
  }
  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
  playTone(freq, type, duration, gainVal = 0.08) {
    try {
      this.init();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {}
  }
  pingHop() {
    this.playTone(587.33, 'sine', 0.08, 0.06); // D5 blip
  }
  pingSuccess() {
    this.playTone(523.25, 'triangle', 0.12, 0.1); // C5
    setTimeout(() => this.playTone(659.25, 'triangle', 0.15, 0.1), 80); // E5
    setTimeout(() => this.playTone(783.99, 'triangle', 0.25, 0.1), 160); // G5
  }
  pingFail() {
    this.playTone(220, 'sawtooth', 0.2, 0.09);
    setTimeout(() => this.playTone(180, 'sawtooth', 0.25, 0.09), 100);
  }
}
const sfx = new AudioFX();

// Network Helper Utilities
const NetUtils = {
  ipToInt(ip) {
    return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
  },
  intToIp(int) {
    return [(int >>> 24) & 255, (int >>> 16) & 255, (int >>> 8) & 255, int & 255].join('.');
  },
  isSameSubnet(ip1, ip2, mask) {
    try {
      const int1 = NetUtils.ipToInt(ip1);
      const int2 = NetUtils.ipToInt(ip2);
      const intMask = NetUtils.ipToInt(mask);
      return (int1 & intMask) === (int2 & intMask);
    } catch (e) {
      return false;
    }
  },
  generateMac() {
    return '00:' + Array.from({ length: 5 }, () =>
      Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()
    ).join(':');
  }
};

// Global Application State
const state = {
  devices: [],
  links: [],
  packets: [],
  events: [],
  activeTool: 'select', // 'select', 'cable', 'ping', 'delete'
  simMode: 'realtime', // 'realtime' or 'simulation'
  simPaused: false,
  cableSource: null,
  pingSource: null,
  selectedDevice: null,
  draggingDevice: null,
  dragOffset: { x: 0, y: 0 },
  nextDeviceId: 1,
  nextLinkPort: 1
};

// Canvas & DOM Element References
const canvas = document.getElementById('networkCanvas');
const ctx = canvas.getContext('2d');
const canvasWrapper = document.getElementById('canvasWrapper');
const toolIndicator = document.getElementById('toolIndicator');
const toastEl = document.getElementById('toast');
const eventDrawer = document.getElementById('eventDrawer');
const drawerToggle = document.getElementById('drawerToggle');
const eventTableBody = document.getElementById('eventTableBody');
const pduCountBadge = document.getElementById('pduCountBadge');

// Resize Canvas to fit container
function resizeCanvas() {
  const rect = canvasWrapper.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}
window.addEventListener('resize', resizeCanvas);

// Toast Notification
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

// Log Event to Bottom Drawer
function logEvent(status, protocol, src, dst, current, details) {
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${Math.floor(now.getMilliseconds() / 100)}`;
  const event = { status, time: timeStr, protocol, src, dst, current, details };
  state.events.unshift(event);
  if (state.events.length > 100) state.events.pop();

  pduCountBadge.textContent = `${state.events.length} events`;

  const tr = document.createElement('tr');
  const statusClass = status === 'SUCCESS' ? 'tag-success' : status === 'FAILED' ? 'tag-fail' : 'tag-info';
  tr.innerHTML = `
    <td class="${statusClass}">${status}</td>
    <td>${timeStr}</td>
    <td><span class="badge" style="background:#334155">${protocol}</span></td>
    <td>${src}</td>
    <td>${dst}</td>
    <td>${current}</td>
    <td>${details}</td>
  `;

  const emptyRow = eventTableBody.querySelector('.empty-row');
  if (emptyRow) emptyRow.remove();
  eventTableBody.insertBefore(tr, eventTableBody.firstChild);
}

// Device Creation Factory
function createDevice(type, x, y, customName = null) {
  const id = state.nextDeviceId++;
  const defaultNames = {
    pc: `PC${id - 1}`,
    server: `Server${id - 1}`,
    switch: `Switch${id - 1}`,
    router: `Router${id - 1}`
  };
  const name = customName || defaultNames[type] || `Dev${id}`;

  const dev = {
    id,
    type,
    name,
    x,
    y,
    radius: 28,
    cliHistory: [],
    cliIndex: -1,
    interfaces: []
  };

  if (type === 'pc' || type === 'server') {
    dev.interfaces.push({
      name: 'FastEthernet0',
      ip: `192.168.1.${10 + id}`,
      mask: '255.255.255.0',
      gateway: '192.168.1.1',
      mac: NetUtils.generateMac()
    });
    dev.arpTable = {}; // ip -> mac
  } else if (type === 'switch') {
    dev.macTable = {}; // mac -> { port, time }
  } else if (type === 'router') {
    dev.interfaces.push({
      name: 'GigabitEthernet0/0',
      ip: `192.168.1.1`,
      mask: '255.255.255.0',
      mac: NetUtils.generateMac()
    });
    dev.interfaces.push({
      name: 'GigabitEthernet0/1',
      ip: `192.168.2.1`,
      mask: '255.255.255.0',
      mac: NetUtils.generateMac()
    });
    dev.routingTable = [
      { network: '192.168.1.0', mask: '255.255.255.0', iface: 'GigabitEthernet0/0', nextHop: 'Direct' },
      { network: '192.168.2.0', mask: '255.255.255.0', iface: 'GigabitEthernet0/1', nextHop: 'Direct' }
    ];
    dev.arpTable = {};
  }

  state.devices.push(dev);
  return dev;
}

// Link Creation
function createLink(devA, devB) {
  if (devA === devB) return null;
  // Check if link already exists
  const exists = state.links.some(l => (l.devA === devA && l.devB === devB) || (l.devA === devB && l.devB === devA));
  if (exists) {
    showToast('A link already exists between these devices.');
    return null;
  }

  const link = {
    id: state.nextLinkPort++,
    devA,
    devB,
    status: 'up'
  };
  state.links.push(link);
  showToast(`Connected ${devA.name} ↔ ${devB.name}`);
  logEvent('INFO', 'LINK', devA.name, devB.name, 'Cable', `Link established (Physical UP)`);
  return link;
}

// Delete Device or Link
function deleteDevice(dev) {
  state.links = state.links.filter(l => l.devA !== dev && l.devB !== dev);
  state.packets = state.packets.filter(p => p.srcDev !== dev && p.dstDev !== dev && p.currentDev !== dev);
  state.devices = state.devices.filter(d => d !== dev);
  if (state.selectedDevice === dev) closeModal();
}

function deleteLink(link) {
  state.links = state.links.filter(l => l !== link);
}

// Find Connected Neighbors of a Device
function getNeighbors(dev) {
  const neighbors = [];
  for (const l of state.links) {
    if (l.devA === dev) neighbors.push({ neighbor: l.devB, link: l });
    else if (l.devB === dev) neighbors.push({ neighbor: l.devA, link: l });
  }
  return neighbors;
}

// Packet Engine
function sendPacket({
  type, // 'ICMP_REQ', 'ICMP_REPLY', 'ARP_REQ', 'ARP_REPLY'
  srcDev,
  dstDev,
  fromDev,
  toDev,
  srcIp,
  dstIp,
  srcMac,
  dstMac,
  originalSender = null,
  targetFinal = null,
  ttl = 64
}) {
  const packet = {
    id: Math.random().toString(36).substring(2, 9),
    type,
    srcDev,
    dstDev,
    fromDev,
    toDev,
    currentDev: fromDev,
    srcIp,
    dstIp,
    srcMac,
    dstMac,
    originalSender: originalSender || fromDev,
    targetFinal: targetFinal || toDev,
    ttl,
    progress: 0, // 0 to 1 along the link
    speed: state.simMode === 'realtime' ? 0.022 : 0.012
  };
  state.packets.push(packet);
  sfx.pingHop();
}

// Step / Update Simulation
function updatePackets() {
  if (state.simPaused) return;

  for (let i = state.packets.length - 1; i >= 0; i--) {
    const p = state.packets[i];
    p.progress += p.speed;

    if (p.progress >= 1) {
      // Arrived at destination node
      state.packets.splice(i, 1);
      handlePacketArrival(p);
    }
  }
}

// Handle packet processing at target node
function handlePacketArrival(p) {
  const node = p.toDev;

  // L2 Learning at Switch
  if (node.type === 'switch') {
    node.macTable[p.srcMac] = { port: p.fromDev.name, time: Date.now() };

    // Flooding or Forwarding
    const neighbors = getNeighbors(node).filter(n => n.neighbor !== p.fromDev);
    if (neighbors.length === 0) {
      logEvent('DROP', p.type, p.srcIp, p.dstIp, node.name, 'No outbound ports on switch');
      return;
    }

    // ARP Request or broadcast destination -> Flood
    if (p.dstMac === 'FF:FF:FF:FF:FF:FF' || !node.macTable[p.dstMac]) {
      logEvent('FLOOD', p.type, p.srcIp, p.dstIp, node.name, `Flooding packet to ${neighbors.length} port(s)`);
      for (const n of neighbors) {
        sendPacket({
          ...p,
          fromDev: node,
          toDev: n.neighbor,
          progress: 0
        });
      }
    } else {
      // Learned unicast forwarding
      const targetNeighborName = node.macTable[p.dstMac].port;
      const targetNeighbor = neighbors.find(n => n.neighbor.name === targetNeighborName);
      if (targetNeighbor) {
        logEvent('FORWARD', p.type, p.srcIp, p.dstIp, node.name, `Switch forwarding via port to ${targetNeighbor.neighbor.name}`);
        sendPacket({
          ...p,
          fromDev: node,
          toDev: targetNeighbor.neighbor,
          progress: 0
        });
      } else {
        // Fallback flood
        for (const n of neighbors) {
          sendPacket({ ...p, fromDev: node, toDev: n.neighbor, progress: 0 });
        }
      }
    }
    return;
  }

  // Router L3 Processing
  if (node.type === 'router') {
    // Check if router owns the destination IP
    const matchedIface = node.interfaces.find(iface => iface.ip === p.dstIp);
    if (matchedIface) {
      if (p.type === 'ICMP_REQ') {
        logEvent('SUCCESS', 'ICMP', p.srcIp, p.dstIp, node.name, 'Echo Request received by Router. Sending Echo Reply');
        sendPacket({
          type: 'ICMP_REPLY',
          srcDev: node,
          dstDev: p.originalSender,
          fromDev: node,
          toDev: p.fromDev,
          srcIp: p.dstIp,
          dstIp: p.srcIp,
          srcMac: matchedIface.mac,
          dstMac: p.srcMac,
          originalSender: node,
          targetFinal: p.originalSender
        });
        return;
      }
    }

    // Routing Lookup
    if (p.ttl <= 1) {
      logEvent('FAILED', 'ICMP', p.srcIp, p.dstIp, node.name, 'Time to Live (TTL) expired in transit');
      sfx.pingFail();
      return;
    }

    // Determine outbound interface based on routing table / subnet
    let outIface = null;
    for (const iface of node.interfaces) {
      if (NetUtils.isSameSubnet(p.dstIp, iface.ip, iface.mask)) {
        outIface = iface;
        break;
      }
    }

    if (!outIface) {
      logEvent('FAILED', 'ROUTING', p.srcIp, p.dstIp, node.name, 'Destination Network Unreachable (No Route)');
      sfx.pingFail();
      return;
    }

    // Find neighbor on outIface
    const neighbors = getNeighbors(node).filter(n => n.neighbor !== p.fromDev);
    if (neighbors.length === 0) {
      logEvent('FAILED', 'ROUTING', p.srcIp, p.dstIp, node.name, `No link attached to interface ${outIface.name}`);
      sfx.pingFail();
      return;
    }

    logEvent('ROUTED', p.type, p.srcIp, p.dstIp, node.name, `Routed via ${outIface.name} (TTL: ${p.ttl - 1})`);

    for (const n of neighbors) {
      sendPacket({
        ...p,
        fromDev: node,
        toDev: n.neighbor,
        srcMac: outIface.mac,
        dstMac: 'FF:FF:FF:FF:FF:FF',
        ttl: p.ttl - 1,
        progress: 0
      });
    }
    return;
  }

  // End Host (PC or Server) Processing
  if (node.type === 'pc' || node.type === 'server') {
    const nodeIface = node.interfaces[0];
    if (!nodeIface) return;

    // Is this packet meant for this host?
    if (p.dstIp !== nodeIface.ip && p.dstMac !== 'FF:FF:FF:FF:FF:FF' && p.dstMac !== nodeIface.mac) {
      // Discard packet not destined for us
      return;
    }

    if (p.type === 'ARP_REQ') {
      if (p.dstIp === nodeIface.ip) {
        logEvent('INFO', 'ARP', p.srcIp, p.dstIp, node.name, `ARP Request matched! Replying with MAC ${nodeIface.mac}`);
        sendPacket({
          type: 'ARP_REPLY',
          srcDev: node,
          dstDev: p.fromDev,
          fromDev: node,
          toDev: p.fromDev,
          srcIp: nodeIface.ip,
          dstIp: p.srcIp,
          srcMac: nodeIface.mac,
          dstMac: p.srcMac,
          originalSender: node,
          targetFinal: p.originalSender
        });
      }
      return;
    }

    if (p.type === 'ICMP_REQ') {
      if (p.dstIp === nodeIface.ip) {
        logEvent('SUCCESS', 'ICMP', p.srcIp, p.dstIp, node.name, `Echo Request received. Transmitting Echo Reply`);
        sfx.pingHop();
        sendPacket({
          type: 'ICMP_REPLY',
          srcDev: node,
          dstDev: p.originalSender,
          fromDev: node,
          toDev: p.fromDev,
          srcIp: nodeIface.ip,
          dstIp: p.srcIp,
          srcMac: nodeIface.mac,
          dstMac: p.srcMac,
          originalSender: node,
          targetFinal: p.originalSender
        });
      }
      return;
    }

    if (p.type === 'ICMP_REPLY') {
      if (p.dstIp === nodeIface.ip) {
        logEvent('SUCCESS', 'ICMP', p.srcIp, p.dstIp, node.name, `Echo Reply received successfully! Round-trip complete.`);
        sfx.pingSuccess();
        showToast(`Ping Success: Reply from ${p.srcIp}`);
      }
      return;
    }
  }
}

// Initiate Ping between two IP hosts
function initiatePing(srcNode, targetIp) {
  const srcIface = srcNode.interfaces ? srcNode.interfaces[0] : null;
  if (!srcIface) {
    showToast(`${srcNode.name} has no valid network interface.`);
    return false;
  }

  logEvent('INFO', 'ICMP', srcIface.ip, targetIp, srcNode.name, `Ping initiated to ${targetIp}`);
  showToast(`Pinging ${targetIp} from ${srcNode.name}...`);

  const neighbors = getNeighbors(srcNode);
  if (neighbors.length === 0) {
    logEvent('FAILED', 'ICMP', srcIface.ip, targetIp, srcNode.name, 'Cable disconnected (No default link)');
    sfx.pingFail();
    showToast(`Ping failed: Cable is disconnected!`);
    return false;
  }

  // Determine next hop MAC
  const isLocal = NetUtils.isSameSubnet(srcIface.ip, targetIp, srcIface.mask);
  let nextHopIp = isLocal ? targetIp : srcIface.gateway;

  for (const n of neighbors) {
    sendPacket({
      type: 'ICMP_REQ',
      srcDev: srcNode,
      dstDev: null,
      fromDev: srcNode,
      toDev: n.neighbor,
      srcIp: srcIface.ip,
      dstIp: targetIp,
      srcMac: srcIface.mac,
      dstMac: 'FF:FF:FF:FF:FF:FF',
      originalSender: srcNode,
      targetFinal: null,
      ttl: 64
    });
  }
  return true;
}

// Render Function
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Draw Links
  for (const l of state.links) {
    const { devA, devB } = l;
    ctx.beginPath();
    ctx.moveTo(devA.x, devA.y);
    ctx.lineTo(devB.x, devB.y);
    ctx.strokeStyle = '#22c55e'; // Green Ethernet link
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(34, 197, 94, 0.4)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Link LEDs
    drawLinkLED(devA, devB, 0.2);
    drawLinkLED(devB, devA, 0.2);
  }

  // 2. Draw Temporary Cable Line during connection
  if (state.activeTool === 'cable' && state.cableSource) {
    ctx.beginPath();
    ctx.moveTo(state.cableSource.x, state.cableSource.y);
    ctx.lineTo(state.mousePos ? state.mousePos.x : state.cableSource.x, state.mousePos ? state.mousePos.y : state.cableSource.y);
    ctx.strokeStyle = '#f59e0b'; // Amber dashed line
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 3. Draw In-Flight Packets
  for (const p of state.packets) {
    const x = p.fromDev.x + (p.toDev.x - p.fromDev.x) * p.progress;
    const y = p.fromDev.y + (p.toDev.y - p.fromDev.y) * p.progress;

    // Envelope Box
    ctx.save();
    ctx.translate(x, y);

    const isReply = p.type.includes('REPLY');
    const color = isReply ? '#10b981' : p.type.startsWith('ARP') ? '#a855f7' : '#38bdf8';

    // Glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-12, -8, 24, 16, 3);
    ctx.fill();

    // Envelope flap line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-10, -6);
    ctx.lineTo(0, 2);
    ctx.lineTo(10, -6);
    ctx.stroke();

    // Protocol label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px ' + getComputedStyle(document.body).getPropertyValue('--font-mono');
    ctx.textAlign = 'center';
    ctx.fillText(p.type.split('_')[0], 0, -12);

    ctx.restore();
  }

  // 4. Draw Devices
  for (const d of state.devices) {
    drawDevice(d);
  }

  // 5. Update and loop
  updatePackets();
  requestAnimationFrame(draw);
}

function drawLinkLED(dev1, dev2, ratio) {
  const x = dev1.x + (dev2.x - dev1.x) * ratio;
  const y = dev1.y + (dev2.y - dev1.y) * ratio;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#10b981';
  ctx.shadowColor = '#10b981';
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawDevice(d) {
  const isSelected = state.selectedDevice === d;
  const isCableSrc = state.cableSource === d;
  const isPingSrc = state.pingSource === d;

  // Selection Ring
  if (isSelected || isCableSrc || isPingSrc) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.radius + 8, 0, Math.PI * 2);
    ctx.strokeStyle = isPingSrc ? '#f59e0b' : isCableSrc ? '#38bdf8' : '#0ea5e9';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Device Circle Background
  ctx.beginPath();
  ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
  ctx.fillStyle = '#1e293b';
  ctx.fill();
  ctx.strokeStyle = isSelected ? '#38bdf8' : '#334155';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Device Emoji Icon
  ctx.font = '26px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const icons = { pc: '💻', server: '🖥️', switch: '🔲', router: '🌐' };
  ctx.fillText(icons[d.type] || '📟', d.x, d.y);

  // Device Name Label
  ctx.font = 'bold 12px ' + getComputedStyle(document.body).getPropertyValue('--font-sans');
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(d.name, d.x, d.y + d.radius + 15);

  // IP Label underneath
  let ipLabel = '';
  if (d.interfaces && d.interfaces.length > 0) {
    if (d.type === 'router') {
      ipLabel = `${d.interfaces[0].ip} / ${d.interfaces[1].ip}`;
    } else {
      ipLabel = d.interfaces[0].ip;
    }
  }
  if (ipLabel) {
    ctx.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--font-mono');
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(ipLabel, d.x, d.y + d.radius + 28);
  }
}

// Find Device at (x, y)
function getDeviceAt(x, y) {
  for (let i = state.devices.length - 1; i >= 0; i--) {
    const d = state.devices[i];
    const dist = Math.hypot(d.x - x, d.y - y);
    if (dist <= d.radius) return d;
  }
  return null;
}

// Find Link at (x, y)
function getLinkAt(x, y) {
  for (const l of state.links) {
    const { devA, devB } = l;
    const dist = distToSegment({ x, y }, devA, devB);
    if (dist < 8) return l;
  }
  return null;
}

function distToSegment(p, v, w) {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

// Mouse Event Handlers on Canvas
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const dev = getDeviceAt(x, y);

  if (state.activeTool === 'select') {
    if (dev) {
      state.draggingDevice = dev;
      state.dragOffset = { x: dev.x - x, y: dev.y - y };
      state.selectedDevice = dev;
    } else {
      state.selectedDevice = null;
    }
  } else if (state.activeTool === 'cable') {
    if (dev) {
      if (!state.cableSource) {
        state.cableSource = dev;
        showToast(`Selected ${dev.name}. Now click target device to connect.`);
      } else {
        createLink(state.cableSource, dev);
        state.cableSource = null;
      }
    } else {
      state.cableSource = null;
    }
  } else if (state.activeTool === 'ping') {
    if (dev) {
      if (!state.pingSource) {
        if (dev.type === 'switch') {
          showToast('Cannot ping from a Layer 2 switch. Choose a PC, Server, or Router.');
          return;
        }
        state.pingSource = dev;
        showToast(`Source set: ${dev.name}. Now click destination device.`);
      } else {
        if (dev === state.pingSource) {
          showToast('Cannot ping self.');
          state.pingSource = null;
          return;
        }
        const targetIp = dev.interfaces ? dev.interfaces[0].ip : null;
        if (!targetIp) {
          showToast(`${dev.name} has no IP address.`);
        } else {
          initiatePing(state.pingSource, targetIp);
        }
        state.pingSource = null;
      }
    } else {
      state.pingSource = null;
    }
  } else if (state.activeTool === 'delete') {
    if (dev) {
      deleteDevice(dev);
      showToast(`Deleted ${dev.name}`);
    } else {
      const link = getLinkAt(x, y);
      if (link) {
        deleteLink(link);
        showToast('Deleted link');
      }
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  state.mousePos = { x, y };

  if (state.draggingDevice) {
    state.draggingDevice.x = Math.max(40, Math.min(rect.width - 40, x + state.dragOffset.x));
    state.draggingDevice.y = Math.max(40, Math.min(rect.height - 40, y + state.dragOffset.y));
  }
});

window.addEventListener('mouseup', () => {
  state.draggingDevice = null;
});

// Double click to open configuration modal
canvas.addEventListener('dblclick', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const dev = getDeviceAt(x, y);
  if (dev) {
    openModal(dev);
  }
});

// HTML5 Drag and Drop from Sidebar Palette
canvasWrapper.addEventListener('dragover', (e) => e.preventDefault());
canvasWrapper.addEventListener('drop', (e) => {
  e.preventDefault();
  const type = e.dataTransfer.getData('text/plain');
  if (type) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dev = createDevice(type, x, y);
    showToast(`Added ${dev.name}`);
    logEvent('INFO', 'CONFIG', dev.name, '-', dev.name, `Device placed on topology`);
  }
});

document.querySelectorAll('.palette-item').forEach(item => {
  item.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', item.dataset.type);
  });
  // Also allow click to place at center
  item.addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect();
    const x = rect.width / 2 + (Math.random() * 80 - 40);
    const y = rect.height / 2 + (Math.random() * 80 - 40);
    const dev = createDevice(item.dataset.type, x, y);
    showToast(`Added ${dev.name}`);
  });
});

// Tool Selection Buttons
const tools = {
  toolSelect: { name: 'select', desc: 'Tool: Select & Move (V)' },
  toolCable: { name: 'cable', desc: 'Tool: Connect Cable (C)' },
  toolPing: { name: 'ping', desc: 'Tool: Ping PDU (P)' },
  toolDelete: { name: 'delete', desc: 'Tool: Delete (Del)' }
};

Object.entries(tools).forEach(([id, t]) => {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    setTool(t.name, t.desc);
  });
});

function setTool(toolName, desc) {
  state.activeTool = toolName;
  state.cableSource = null;
  state.pingSource = null;
  document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById('tool' + toolName.charAt(0).toUpperCase() + toolName.slice(1));
  if (activeBtn) activeBtn.classList.add('active');
  toolIndicator.textContent = desc;
}

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'v' || e.key === 'V') setTool('select', tools.toolSelect.desc);
  if (e.key === 'c' || e.key === 'C') setTool('cable', tools.toolCable.desc);
  if (e.key === 'p' || e.key === 'P') setTool('ping', tools.toolPing.desc);
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedDevice) {
      deleteDevice(state.selectedDevice);
      state.selectedDevice = null;
    }
  }
});

// Drawer toggle
drawerToggle.addEventListener('click', () => {
  eventDrawer.classList.toggle('expanded');
});
document.getElementById('btnClearLog').addEventListener('click', (e) => {
  e.stopPropagation();
  state.events = [];
  eventTableBody.innerHTML = '<tr class="empty-row"><td colspan="7">No packet transmissions yet.</td></tr>';
  pduCountBadge.textContent = '0 events';
});

// Realtime vs Simulation Mode
const btnRealtime = document.getElementById('btnRealtime');
const btnSimulation = document.getElementById('btnSimulation');
const simControls = document.getElementById('simControls');
const btnSimPlay = document.getElementById('btnSimPlay');
const btnSimStep = document.getElementById('btnSimStep');
const btnSimReset = document.getElementById('btnSimReset');

btnRealtime.addEventListener('click', () => {
  state.simMode = 'realtime';
  state.simPaused = false;
  btnRealtime.classList.add('active');
  btnSimulation.classList.remove('active');
  simControls.style.display = 'none';
  eventDrawer.classList.remove('expanded');
});

btnSimulation.addEventListener('click', () => {
  state.simMode = 'simulation';
  state.simPaused = true;
  btnSimulation.classList.add('active');
  btnRealtime.classList.remove('active');
  simControls.style.display = 'flex';
  btnSimPlay.textContent = '▶️';
  eventDrawer.classList.add('expanded');
});

btnSimPlay.addEventListener('click', () => {
  state.simPaused = !state.simPaused;
  btnSimPlay.textContent = state.simPaused ? '▶️' : '⏸️';
});

btnSimStep.addEventListener('click', () => {
  state.simPaused = true;
  btnSimPlay.textContent = '▶️';
  for (let i = 0; i < 5; i++) updatePackets();
});

btnSimReset.addEventListener('click', () => {
  state.packets = [];
  showToast('Cleared active in-flight packets');
});

// Device Modal & CLI Management
const deviceModal = document.getElementById('deviceModal');
const modalClose = document.getElementById('modalClose');
const modalSave = document.getElementById('modalSave');
const modalDeviceIcon = document.getElementById('modalDeviceIcon');
const modalDeviceName = document.getElementById('modalDeviceName');
const modalDeviceType = document.getElementById('modalDeviceType');
const cfgDeviceName = document.getElementById('cfgDeviceName');
const interfaceConfigsContainer = document.getElementById('interfaceConfigsContainer');
const cliOutput = document.getElementById('cliOutput');
const cliPrompt = document.getElementById('cliPrompt');
const cliInput = document.getElementById('cliInput');
const tablesContainer = document.getElementById('tablesContainer');

function openModal(dev) {
  state.selectedDevice = dev;
  deviceModal.style.display = 'flex';

  const icons = { pc: '💻', server: '🖥️', switch: '🔲', router: '🌐' };
  modalDeviceIcon.textContent = icons[dev.type] || '📟';
  modalDeviceName.textContent = dev.name;
  modalDeviceType.textContent = dev.type.toUpperCase() + ' Configuration & CLI';
  cfgDeviceName.value = dev.name;

  // Render Interfaces Configuration
  interfaceConfigsContainer.innerHTML = '';
  if (dev.interfaces && dev.interfaces.length > 0) {
    dev.interfaces.forEach((iface, idx) => {
      const card = document.createElement('div');
      card.className = 'interface-card';
      card.innerHTML = `
        <div class="interface-title">
          <span>Port: ${iface.name}</span>
          <span style="font-size:11px; color:#94a3b8">MAC: ${iface.mac}</span>
        </div>
        <div class="form-group">
          <label>IP Address</label>
          <input type="text" class="form-input" id="cfgIp_${idx}" value="${iface.ip}">
        </div>
        <div class="form-group">
          <label>Subnet Mask</label>
          <input type="text" class="form-input" id="cfgMask_${idx}" value="${iface.mask}">
        </div>
        ${iface.gateway !== undefined ? `
        <div class="form-group">
          <label>Default Gateway</label>
          <input type="text" class="form-input" id="cfgGw_${idx}" value="${iface.gateway}">
        </div>` : ''}
      `;
      interfaceConfigsContainer.appendChild(card);
    });
  } else {
    interfaceConfigsContainer.innerHTML = `<div style="color:#94a3b8; font-size:12px; margin-top:12px;">This Layer 2 switch operates without IP interfaces.</div>`;
  }

  // Render Tables View
  renderTablesView(dev);

  // Initialize CLI Terminal
  cliPrompt.textContent = `${dev.name}>`;
  cliOutput.innerHTML = `Cisco IOS Software, Web Packet Tracer Simulation Engine\nType "help" for a list of available commands.\n\n`;
  cliInput.value = '';
  cliInput.focus();
}

function renderTablesView(dev) {
  let html = '';
  if (dev.type === 'switch') {
    html += `
      <div class="table-section">
        <h4>MAC Address Table</h4>
        <table>
          <thead><tr><th>VLAN</th><th>Mac Address</th><th>Type</th><th>Ports</th></tr></thead>
          <tbody>
    `;
    const entries = Object.entries(dev.macTable || {});
    if (entries.length === 0) {
      html += `<tr><td colspan="4" style="text-align:center; color:#64748b;">No dynamic MAC entries learned yet.</td></tr>`;
    } else {
      for (const [mac, info] of entries) {
        html += `<tr><td>1</td><td>${mac}</td><td>DYNAMIC</td><td>${info.port}</td></tr>`;
      }
    }
    html += `</tbody></table></div>`;
  } else if (dev.type === 'router') {
    html += `
      <div class="table-section">
        <h4>IP Routing Table</h4>
        <table>
          <thead><tr><th>Type</th><th>Network</th><th>Subnet Mask</th><th>Interface / Next Hop</th></tr></thead>
          <tbody>
    `;
    for (const r of dev.routingTable || []) {
      html += `<tr><td>C (Connected)</td><td>${r.network}</td><td>${r.mask}</td><td>${r.iface}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  } else {
    html += `
      <div class="table-section">
        <h4>ARP Table</h4>
        <table>
          <thead><tr><th>Internet Address</th><th>Physical Address (MAC)</th><th>Type</th></tr></thead>
          <tbody>
    `;
    const entries = Object.entries(dev.arpTable || {});
    if (entries.length === 0) {
      html += `<tr><td colspan="3" style="text-align:center; color:#64748b;">ARP cache is currently empty.</td></tr>`;
    } else {
      for (const [ip, mac] of entries) {
        html += `<tr><td>${ip}</td><td>${mac}</td><td>dynamic</td></tr>`;
      }
    }
    html += `</tbody></table></div>`;
  }
  tablesContainer.innerHTML = html;
}

function closeModal() {
  deviceModal.style.display = 'none';
  state.selectedDevice = null;
}
modalClose.addEventListener('click', closeModal);

modalSave.addEventListener('click', () => {
  const dev = state.selectedDevice;
  if (!dev) return closeModal();

  dev.name = cfgDeviceName.value.trim() || dev.name;
  if (dev.interfaces) {
    dev.interfaces.forEach((iface, idx) => {
      const ipInput = document.getElementById(`cfgIp_${idx}`);
      const maskInput = document.getElementById(`cfgMask_${idx}`);
      const gwInput = document.getElementById(`cfgGw_${idx}`);
      if (ipInput) iface.ip = ipInput.value.trim();
      if (maskInput) iface.mask = maskInput.value.trim();
      if (gwInput) iface.gateway = gwInput.value.trim();
    });
  }
  showToast(`Updated settings for ${dev.name}`);
  closeModal();
});

// Modal Tab Navigation
document.querySelectorAll('.modal-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'tabCli') cliInput.focus();
    if (tab.dataset.tab === 'tabTables' && state.selectedDevice) renderTablesView(state.selectedDevice);
  });
});

// CLI Command Parser & Terminal Execution
cliInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const cmd = cliInput.value.trim();
    if (!cmd) return;
    executeCliCommand(cmd);
    cliInput.value = '';
  }
});

function executeCliCommand(cmd) {
  const dev = state.selectedDevice;
  if (!dev) return;

  cliOutput.innerHTML += `${dev.name}> ${cmd}\n`;
  const parts = cmd.split(/\s+/);
  const action = parts[0].toLowerCase();

  switch (action) {
    case 'help':
    case '?':
      cliOutput.innerHTML += `
Commands available:
  ping <ip>             Send ICMP Echo Requests to target IP
  ipconfig              Display IP configuration for all interfaces
  arp -a                Show ARP cache table
  show mac-address-table Show L2 switch switching table
  show ip route         Display IP routing table (Router)
  clear / cls           Clear the terminal screen
  exit                  Close configuration window
\n`;
      break;

    case 'clear':
    case 'cls':
      cliOutput.innerHTML = '';
      break;

    case 'exit':
      closeModal();
      break;

    case 'ipconfig':
      if (dev.interfaces && dev.interfaces.length > 0) {
        dev.interfaces.forEach(iface => {
          cliOutput.innerHTML += `
FastEthernet Adapter ${iface.name}:
  Connection-specific DNS Suffix  . : local
  Physical Address. . . . . . . . . : ${iface.mac}
  IPv4 Address. . . . . . . . . . . : ${iface.ip}
  Subnet Mask . . . . . . . . . . . : ${iface.mask}
  Default Gateway . . . . . . . . . : ${iface.gateway || '0.0.0.0'}
`;
        });
      } else {
        cliOutput.innerHTML += `Layer 2 Switch device has no IP interfaces.\n`;
      }
      break;

    case 'arp':
      if (parts[1] === '-a') {
        const entries = Object.entries(dev.arpTable || {});
        if (entries.length === 0) {
          cliOutput.innerHTML += `No ARP Entries Found.\n`;
        } else {
          cliOutput.innerHTML += `Interface: ${dev.interfaces[0].ip} --- 0x2\n  Internet Address      Physical Address      Type\n`;
          for (const [ip, mac] of entries) {
            cliOutput.innerHTML += `  ${ip.padEnd(22)}${mac.padEnd(22)}dynamic\n`;
          }
        }
      } else {
        cliOutput.innerHTML += `Usage: arp -a\n`;
      }
      break;

    case 'show':
      const target = (parts[1] || '').toLowerCase();
      if (target === 'mac-address-table' || target === 'mac') {
        if (dev.type !== 'switch') {
          cliOutput.innerHTML += `% Command only available on switch devices.\n`;
        } else {
          cliOutput.innerHTML += `          Mac Address Table\n-------------------------------------------\nVlan    Mac Address       Type        Ports\n----    -----------       --------    -----\n`;
          for (const [mac, info] of Object.entries(dev.macTable || {})) {
            cliOutput.innerHTML += `   1    ${mac}    DYNAMIC     ${info.port}\n`;
          }
        }
      } else if (target === 'ip' && (parts[2] || '').toLowerCase() === 'route') {
        if (dev.type !== 'router') {
          cliOutput.innerHTML += `% Routing table only available on router devices.\n`;
        } else {
          cliOutput.innerHTML += `Codes: C - connected, S - static, R - RIP\nGateway of last resort is not set\n\n`;
          for (const r of dev.routingTable || []) {
            cliOutput.innerHTML += `C    ${r.network}/24 is directly connected, ${r.iface}\n`;
          }
        }
      } else {
        cliOutput.innerHTML += `% Incomplete or invalid command.\n`;
      }
      break;

    case 'ping':
      const targetIp = parts[1];
      if (!targetIp) {
        cliOutput.innerHTML += `Usage: ping <target-ip>\n`;
        break;
      }
      cliOutput.innerHTML += `\nPinging ${targetIp} with 32 bytes of data:\n`;
      initiatePing(dev, targetIp);
      cliOutput.innerHTML += `Transmitting ICMP echo packet... check simulation canvas.\n\n`;
      break;

    default:
      cliOutput.innerHTML += `% Invalid command: "${cmd}". Type "help" for a list of available commands.\n`;
  }
  cliOutput.scrollTop = cliOutput.scrollHeight;
}

// Preset Topologies
function loadPreset(name) {
  state.devices = [];
  state.links = [];
  state.packets = [];
  state.events = [];
  state.nextDeviceId = 1;
  state.nextLinkPort = 1;
  eventTableBody.innerHTML = '<tr class="empty-row"><td colspan="7">No packet transmissions yet.</td></tr>';
  pduCountBadge.textContent = '0 events';

  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;

  if (name === 'p2p') {
    const pc0 = createDevice('pc', w * 0.35, h * 0.5, 'PC0');
    const pc1 = createDevice('pc', w * 0.65, h * 0.5, 'PC1');
    pc0.interfaces[0].ip = '192.168.1.10';
    pc1.interfaces[0].ip = '192.168.1.11';
    createLink(pc0, pc1);
    showToast('Loaded Direct PC-to-PC Topology');
  } else if (name === 'switch') {
    const sw = createDevice('switch', w * 0.5, h * 0.4, 'Switch0');
    const pc0 = createDevice('pc', w * 0.25, h * 0.7, 'PC0');
    const pc1 = createDevice('pc', w * 0.5, h * 0.75, 'PC1');
    const pc2 = createDevice('pc', w * 0.75, h * 0.7, 'PC2');
    pc0.interfaces[0].ip = '192.168.1.10';
    pc1.interfaces[0].ip = '192.168.1.11';
    pc2.interfaces[0].ip = '192.168.1.12';
    createLink(sw, pc0);
    createLink(sw, pc1);
    createLink(sw, pc2);
    showToast('Loaded Switch Star LAN (3 PCs)');
  } else if (name === 'routed') {
    const router = createDevice('router', w * 0.5, h * 0.35, 'Router0');
    const sw0 = createDevice('switch', w * 0.28, h * 0.55, 'Switch0');
    const sw1 = createDevice('switch', w * 0.72, h * 0.55, 'Switch1');
    const pc0 = createDevice('pc', w * 0.18, h * 0.78, 'PC0');
    const pc1 = createDevice('pc', w * 0.82, h * 0.78, 'PC1');

    pc0.interfaces[0].ip = '192.168.1.10';
    pc0.interfaces[0].gateway = '192.168.1.1';

    pc1.interfaces[0].ip = '192.168.2.10';
    pc1.interfaces[0].gateway = '192.168.2.1';

    createLink(router, sw0);
    createLink(router, sw1);
    createLink(sw0, pc0);
    createLink(sw1, pc1);
    showToast('Loaded Two Subnets via Router');
  } else if (name === 'empty') {
    showToast('Cleared Canvas');
  }
}

// Preset Handlers
document.getElementById('presetP2P').addEventListener('click', (e) => { e.preventDefault(); loadPreset('p2p'); });
document.getElementById('presetSwitch').addEventListener('click', (e) => { e.preventDefault(); loadPreset('switch'); });
document.getElementById('presetRouted').addEventListener('click', (e) => { e.preventDefault(); loadPreset('routed'); });
document.getElementById('presetEmpty').addEventListener('click', (e) => { e.preventDefault(); loadPreset('empty'); });
document.getElementById('btnClearAll').addEventListener('click', () => loadPreset('empty'));

// Export & Import Topology JSON
document.getElementById('btnExport').addEventListener('click', () => {
  const exportData = {
    devices: state.devices.map(d => ({
      id: d.id,
      type: d.type,
      name: d.name,
      x: d.x,
      y: d.y,
      interfaces: d.interfaces,
      routingTable: d.routingTable
    })),
    links: state.links.map(l => ({
      devAId: l.devA.id,
      devBId: l.devB.id
    }))
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `packet-tracer-topology-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Topology exported to JSON file');
});

document.getElementById('fileImport').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      state.devices = [];
      state.links = [];
      state.packets = [];

      const idMap = new Map();
      for (const d of data.devices) {
        const newDev = createDevice(d.type, d.x, d.y, d.name);
        newDev.id = d.id;
        if (d.interfaces) newDev.interfaces = d.interfaces;
        if (d.routingTable) newDev.routingTable = d.routingTable;
        idMap.set(d.id, newDev);
      }

      for (const l of data.links) {
        const devA = idMap.get(l.devAId);
        const devB = idMap.get(l.devBId);
        if (devA && devB) createLink(devA, devB);
      }
      showToast('Topology imported successfully');
    } catch (err) {
      alert('Error parsing topology JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
});

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  resizeCanvas();
  // Load initial preset (Two Subnets via Router for an impressive demo)
  loadPreset('routed');
  requestAnimationFrame(draw);
});
