const listeners = new Set();
let state = { active: false, message: "" };

const DownloadManager = {
  show(message) {
    state = { active: true, message: message || "Downloading..." };
    listeners.forEach((fn) => fn(state));
  },

  hide() {
    state = { active: false, message: "" };
    listeners.forEach((fn) => fn(state));
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  unsubscribe(listener) {
    listeners.delete(listener);
  },

  getState() {
    return state;
  },
};

export default DownloadManager;
