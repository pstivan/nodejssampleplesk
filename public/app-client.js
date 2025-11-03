// Minimal client code — place in public/app-client.js
const api = (path, opts={}) => fetch(`/api${path}`, {
  headers: opts.headers || {},
  method: opts.method || "GET",
  body: opts.body
}).then(r => r.json().catch(()=>({})));
const $ = id => document.getElementById(id);
let token = localStorage.getItem("token");
function setToken(t){
  token = t;
  if (t) localStorage.setItem("token", t);
  else localStorage.removeItem("token");
  render();
}
async function register(){
  const username = $("username").value;
  const password = $("password").value;
  const res = await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    headers: { "Content-Type":"application/json" }
  });
  if (res.token) setToken(res.token);
  alert(JSON.stringify(res));
  loadTasks();
}
async function login(){
  const username = $("username").value;
  const password = $("password").value;
  const res = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    headers: { "Content-Type":"application/json" }
  });
  if (res.token) setToken(res.token);
  alert(JSON.stringify(res));
  loadTasks();
}
async function createTask(){
  const title = $("title").value;
  const desc = $("desc").value;
  const file = $("file").files[0];
  const form = new FormData();
  form.append("title", title);
  form.append("description", desc);
  if (file) form.append("attachment", file);
  const res = await fetch("/api/tasks", {
    method: "POST",
    body: form,
    headers: token ? { "Authorization": "Bearer "+token } : {}
  });
  const data = await res.json();
  console.log("created", data);
  loadTasks();
}
async function loadTasks(){
  const res = await fetch("/api/tasks", {
    headers: token ? { "Authorization": "Bearer "+token } : {}
  });
  if (res.status === 401) {
    setToken(null);
    //alert("Please login");
    return;
  }
  const data = await res.json();
  const out = $("tasks");
  out.innerHTML = "";
  (data || []).forEach(t => {
    const div = document.createElement("div");
    div.className = "task";
    div.innerHTML = `<strong>${t.title}</strong><div>${t.description || ""}</div>
      ${t.attachment ? `<div><a href="${t.attachment}" target="_blank">Attachment</a></div>` : ""}
      <small>id: ${t.id}</small>`;
    out.appendChild(div);
  });
}
function render(){
  if (token) {
    $("create").style.display = "block";
    $("me").textContent = "Logged in";
  } else {
    $("create").style.display = "none";
    $("me").textContent = "Not logged in";
  }
}
document.getElementById("register").onclick = register;
document.getElementById("login").onclick = login;
document.getElementById("createBtn").onclick = createTask;
render();
loadTasks();
