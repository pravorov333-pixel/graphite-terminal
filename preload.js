const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  http: (method, url, body, timeout) => ipcRenderer.invoke("http", { method, url, body, timeout }),
  bookBase: () => ipcRenderer.invoke("book-base"),
  open: (url) => ipcRenderer.invoke("open", url),
  appName: () => ipcRenderer.invoke("app-name"),
});
