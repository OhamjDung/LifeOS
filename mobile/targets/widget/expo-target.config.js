/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "widget",
  name: "LifeOS Widget",
  bundleIdentifier: "com.lifeos.app.widget",
  deploymentTarget: "17.0",
  entitlements: {
    "com.apple.security.application-groups": ["group.com.lifeos.app"],
  },
};
