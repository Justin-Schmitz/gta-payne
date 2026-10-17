// `node server.js --dev` runs the save API (default :4142) next to vite and sets API_PORT.
const apiPort = process.env.API_PORT || 4142;
const proxy = { '/api': `http://127.0.0.1:${apiPort}` };

export default {
  server: { host: true, proxy },
  preview: { host: true, proxy },
};
