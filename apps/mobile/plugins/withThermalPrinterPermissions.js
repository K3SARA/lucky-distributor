const { withAndroidManifest, withInfoPlist } = require("@expo/config-plugins");

// Bluetooth permissions needed by @finan-me/react-native-thermal-printer to
// scan for and connect to a Classic Bluetooth SPP thermal printer. Injected
// via a config plugin (rather than committing a native android/ project)
// so `expo prebuild` / EAS Build regenerate them automatically.
const withThermalPrinterPermissions = (config) => {
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    manifest["uses-permission"] = manifest["uses-permission"] || [];

    const addPermission = (name, extraAttrs = {}) => {
      const exists = manifest["uses-permission"].some(
        (item) => item.$["android:name"] === name
      );
      if (exists) return;
      manifest["uses-permission"].push({
        $: { "android:name": name, ...extraAttrs }
      });
    };

    addPermission("android.permission.BLUETOOTH_SCAN", {
      "android:usesPermissionFlags": "neverForLocation",
      "tools:targetApi": "31"
    });
    addPermission("android.permission.BLUETOOTH_CONNECT", {
      "tools:targetApi": "31"
    });
    addPermission("android.permission.BLUETOOTH", { "android:maxSdkVersion": "30" });
    addPermission("android.permission.BLUETOOTH_ADMIN", { "android:maxSdkVersion": "30" });
    addPermission("android.permission.ACCESS_FINE_LOCATION", { "android:maxSdkVersion": "30" });

    return config;
  });

  config = withInfoPlist(config, (config) => {
    config.modResults.NSBluetoothAlwaysUsageDescription =
      config.modResults.NSBluetoothAlwaysUsageDescription
      || "Lucky POS needs Bluetooth access to connect to the receipt printer.";
    config.modResults.NSBluetoothPeripheralUsageDescription =
      config.modResults.NSBluetoothPeripheralUsageDescription
      || "Lucky POS needs Bluetooth access to discover and connect to the receipt printer.";
    return config;
  });

  return config;
};

module.exports = withThermalPrinterPermissions;
