window.addEventListener("DOMContentLoaded", () => {
  const { ipcRenderer } = require("electron");
  // on an 'update' event, display the latest message
  ipcRenderer.on('update', (event, msg) => {
    document.getElementById("content").innerHTML += `<p>${msg}</p>`;
  });
  // on an 'error' event, display the error and stop the loading animation
  ipcRenderer.on('error', (event, msg, err) => {
    document.getElementById("content").innerHTML += `<p>${msg}</p>`;
    document.getElementById("content").innerHTML += `<p>${err}</p>`;
    document.getElementById("content").innerHTML += `<p>Tesserae failed to initialize</p>`;
    document.getElementById("content").innerHTML += `<p>You may close this window to end Tesserae</p>`;

    document.getElementById("loading").remove();
  });

  // repeated loading animation
  const animateLoading = () => {
    let curLoad = document.getElementById("loading").innerHTML;
    if (curLoad === null) {
      return
    }
    if (curLoad.length >= 6) {
      document.getElementById("loading").innerHTML = " ";
    } else {
      document.getElementById("loading").innerHTML += ". ";
    }
    setTimeout(animateLoading, 1000);
  };
  animateLoading();
});
