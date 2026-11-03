const pandaPreset = require('pandasuite-bridge-react/tailwind.config');

module.exports = {
  presets: [pandaPreset],
  // Reaches the Session editor only: the Authentication build imports no Tailwind CSS
  plugins: [require('pandasuite-bridge/studio-theme')],
};
