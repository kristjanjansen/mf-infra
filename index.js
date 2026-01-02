const stage = document.getElementById("stage");
const viewport = document.getElementById("viewport");
const svg = document.getElementById("links");
const nodesLayer = document.getElementById("nodes");
const meta = document.getElementById("meta");

const state = {
  transform: d3.zoomIdentity,
  layout: null,
};

function setTransform(t) {
  state.transform = t;
  viewport.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
}

function resizeSvg(w, h) {
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
}

function clear() {
  nodesLayer.innerHTML = "";
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function render(treeData) {
  clear();

  const root = d3.hierarchy(treeData);
  const dx = 110;
  const dy = 340;
  const layout = d3.tree().nodeSize([dx, dy]);
  layout(root);

  const nodes = root.descendants();
  const links = root.links();

  const x0 = d3.min(nodes, (d) => d.x) ?? 0;
  const x1 = d3.max(nodes, (d) => d.x) ?? 0;
  const y0 = d3.min(nodes, (d) => d.y) ?? 0;
  const y1 = d3.max(nodes, (d) => d.y) ?? 0;

  const margin = 80;
  const width = y1 - y0 + margin * 2;
  const height = x1 - x0 + margin * 2;

  resizeSvg(width, height);

  const shiftX = margin - y0;
  const shiftY = margin - x0;

  const linkPath = d3
    .linkHorizontal()
    .x((d) => d.y)
    .y((d) => d.x);

  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.appendChild(g);

  for (const l of links) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("class", "link");
    const d = linkPath({
      source: { x: l.source.x + shiftY, y: l.source.y + shiftX },
      target: { x: l.target.x + shiftY, y: l.target.y + shiftX },
    });
    p.setAttribute("d", d);
    g.appendChild(p);
  }

  for (const n of nodes) {
    const div = document.createElement("div");
    div.className = "node";

    const label = n.data.label || n.data.id;
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = label;

    if (n.data?.meta?.environment) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = n.data.meta.environment;
      name.appendChild(b);
    }

    div.appendChild(name);

    if (n.data?.meta?.deploy_url) {
      const line = document.createElement("div");
      line.className = "line";
      line.textContent = n.data.meta.deploy_url;
      div.appendChild(line);
    }

    if (n.data?.meta?.status) {
      const line = document.createElement("div");
      line.className = "line";
      line.textContent = n.data.meta.status;
      div.appendChild(line);
    }

    const left = n.y + shiftX;
    const top = n.x + shiftY;

    div.style.left = `${left}px`;
    div.style.top = `${top}px`;

    nodesLayer.appendChild(div);
  }

  const initial = d3.zoomIdentity.translate(20, 20).scale(1);
  setTransform(initial);

  state.layout = { width, height };
}

async function main() {
  const res = await fetch("./datasets/deps.json", { cache: "no-store" });
  const data = await res.json();

  if (data.generated_at) {
    meta.textContent = `updated ${data.generated_at}`;
  }

  render(data.root);

  const zoom = d3
    .zoom()
    .scaleExtent([0.25, 2.5])
    .on("zoom", (event) => setTransform(event.transform));

  d3.select(stage).call(zoom);
}

main().catch((e) => {
  meta.textContent = String(e);
});
