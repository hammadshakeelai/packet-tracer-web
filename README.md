# 🌐 Web Packet Tracer

A lightweight, interactive web-based network simulator inspired by **Cisco Packet Tracer**. Built with modern vanilla JavaScript, HTML5 Canvas, and Web Audio API — zero dependencies, fast, and runs directly in your browser.

🔗 **Live Demo (GitHub Pages):** [https://hammadshakeelai.github.io/packet-tracer-web/](https://hammadshakeelai.github.io/packet-tracer-web/)

---

## ✨ Features

- **Interactive Topology Canvas:**
  - Drag-and-drop or click to place network devices:
    - 💻 **PC Workstations** (Host with IP, Subnet Mask, Gateway, ARP cache)
    - 🖥️ **Servers** (Host endpoints)
    - 🔲 **2960 Layer 2 Switches** (Dynamic MAC Address learning & frame forwarding/flooding)
    - 🌐 **2811 Layer 3 Routers** (Multi-interface routing, subnet routing table, TTL decrement)
  - **Copper Straight-Through Cables** with real-time green link status LEDs.
  - Device dragging, connection creation, and deletion tools.

- **Realistic Packet Simulation & Animation:**
  - Visual envelopes traveling across physical links.
  - **ARP Resolution** (broadcast request + unicast response).
  - **ICMP Echo (Ping)** request and reply cycles.
  - **Real-Time vs Simulation Mode:** Toggle between continuous execution and step-by-step PDU inspection (Play, Pause, Step Forward).
  - Bottom **Simulation Event Log & PDU Inspector** table tracking status, protocol, source, destination, and transit hops.

- **Cisco-like Device CLI & Configuration:**
  - Double-click any device or click with the Select tool to open the configuration modal:
    - ⚙️ **Config Tab:** Configure display name, IP address, subnet mask, and default gateway.
    - 💻 **Command Prompt Tab:** Realistic Cisco terminal supporting:
      - `ping <ip>`
      - `ipconfig`
      - `arp -a`
      - `show mac-address-table` (Switch)
      - `show ip route` (Router)
      - `clear` / `help` / `exit`
    - 📊 **Tables Tab:** View live ARP cache, MAC address tables, and IP routing tables.

- **Preloaded Topologies:**
  - Direct PC-to-PC Link
  - Switch Star LAN (3 PCs connected to a 2960 Switch)
  - Routed Network (PC0 on 192.168.1.0/24 ↔ Router ↔ PC1 on 192.168.2.0/24)
  - Blank Workspace

- **Export & Import:**
  - Save topologies to `.json` files and reload them anytime.

- **Web Audio Sound Effects:**
  - Synthesized audio cues for packet hops, ping success chimes, and host unreachable alerts.

---

## 🚀 Getting Started

No build process, NodeJS, or external packages are needed!

### Local Development
Simply open `index.html` in any web browser or serve it with any static server:
```bash
# Python
python -m http.server 8000

# or npx
npx serve .
```

### GitHub Pages Deployment
This repository is configured to deploy directly to GitHub Pages from the `main` branch.

---

## 📜 Keyboard Shortcuts

| Key | Tool / Action |
|-----|---------------|
| `V` | **Select & Move** |
| `C` | **Cable Tool** (Connect devices) |
| `P` | **Ping PDU** (Send ICMP Ping) |
| `Del` / `Backspace` | **Delete** selected device or link |

---

## 📄 License

MIT License. Open-source and free for educational and personal use.
