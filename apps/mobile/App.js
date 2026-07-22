import { useEffect, useMemo, useState } from "react";
import { Image, Modal, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, Vibration, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { io } from "socket.io-client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { calculateTotals, PAYMENT_TYPES, SOCKET_EVENTS } from "@lucky/shared";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE || "http://10.0.2.2:4010";
const ORDER_LORRIES = ["Lorry A", "Lorry A Overflow", "Lorry B", "Lorry B Overflow"];
const PRINTER_STORAGE_KEY = "lucky_pos_printer";

// @finan-me/react-native-thermal-printer throws at import time when its native
// module isn't linked (e.g. in Expo Go, which only ships Expo's own SDK
// modules). Load it lazily so the rest of the app still works there - only
// printing itself becomes unavailable until you're running the real dev
// client build.
let cachedThermalPrinter;
const getThermalPrinter = () => {
  if (cachedThermalPrinter !== undefined) return cachedThermalPrinter;
  try {
    cachedThermalPrinter = require("@finan-me/react-native-thermal-printer").ThermalPrinter;
  } catch {
    cachedThermalPrinter = null;
  }
  return cachedThermalPrinter;
};
const currency = (value) => `LKR ${Number(value || 0).toFixed(2)}`;
const productSalePrice = (product) => Number(product?.billingPrice ?? product?.price ?? product?.mrp ?? 0);
const lineBasePrice = (line) => Number(line?.basePrice ?? line?.price ?? 0);
const lineItemDiscount = (line) => Number(line?.itemDiscount || 0);
const lineFinalPrice = (line) => Math.max(0, lineBasePrice(line) - Math.max(0, lineItemDiscount(line)));
const productDisplayName = (product) => {
  const name = String(product?.name || "").trim();
  const size = String(product?.size || "").trim();
  return size ? `${name} ${size}` : name;
};

// Classic Bluetooth SPP printers (e.g. Xprinter XP-P801A) only work on Android -
// iOS restricts Bluetooth Classic to MFi-certified accessories, which these aren't.
const requestBluetoothPermissions = async () => {
  if (Platform.OS !== "android") return true;
  if (Platform.Version >= 31) {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
    ]);
    return (
      granted["android.permission.BLUETOOTH_SCAN"] === "granted"
      && granted["android.permission.BLUETOOTH_CONNECT"] === "granted"
    );
  }
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return granted === "granted";
};

// Native scan results return a bare MAC address (no scheme prefix); the
// library's print job needs it prefixed with the transport scheme.
const toPrinterAddress = (device) => {
  const raw = String(device?.address || "").trim();
  if (!raw) return "";
  return /^(bt|ble|lan):/i.test(raw) ? raw : `bt:${raw}`;
};

const buildReceiptDocument = (sale) => {
  const lines = Array.isArray(sale?.lines) ? sale.lines : [];
  const rows = lines.map((line) => [
    String(line?.name || "").slice(0, 20),
    String(Number(line?.quantity || 0)),
    currency(Number(line?.price || 0)),
    currency(Number(line?.price || 0) * Number(line?.quantity || 0))
  ]);
  const createdAt = new Date(sale?.createdAt || Date.now());
  return [
    { type: "text", content: "Lucky Distributor", style: { align: "center", bold: true, size: 2 } },
    { type: "text", content: "LUCKY DAIRY DISTRIBUTOR - POLONNARUWA", style: { align: "center" } },
    { type: "line" },
    { type: "text", content: `Customer: ${sale?.customerName || "Walk-in"}` },
    { type: "text", content: `Date: ${Number.isNaN(createdAt.getTime()) ? "-" : createdAt.toLocaleString()}` },
    { type: "text", content: `Rep: ${sale?.cashier || "-"}` },
    { type: "text", content: `Bill No: ${sale?.id || "-"}` },
    { type: "line" },
    {
      type: "table",
      headers: ["Item", "Qty", "Price", "Total"],
      rows,
      columnWidths: [40, 15, 20, 25],
      alignments: ["left", "center", "right", "right"]
    },
    { type: "line" },
    { type: "text", content: `TOTAL: ${currency(sale?.total)}`, style: { bold: true, size: 2 } },
    { type: "text", content: `Payment: ${String(sale?.paymentType || "").toUpperCase()}` },
    { type: "feed", lines: 2 },
    { type: "text", content: "Thank you!", style: { align: "center" } },
    { type: "feed", lines: 3 },
    { type: "cut" }
  ];
};

const LoginScreen = ({ onSubmit, error, apiBase }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <View style={styles.loginWrap}>
      <Image source={require("./assets/lucky-logo.png")} style={styles.mobileLogo} resizeMode="contain" />
      <Text style={styles.loginTitle}>Lucky POS</Text>
      <Text style={styles.loginHint}>API: {apiBase}</Text>
      <Text style={styles.loginFieldLabel}>Credentials</Text>
      <TextInput value={username} onChangeText={setUsername} placeholder="Username" style={styles.input} autoCapitalize="none" />
      <TextInput value={password} onChangeText={setPassword} placeholder="Password" style={styles.input} secureTextEntry />
      {error ? <Text style={styles.loginError}>{error}</Text> : null}
      <TouchableOpacity style={styles.primary} onPress={() => onSubmit({ username, password })}>
        <Text style={styles.primaryLabel}>Sign In</Text>
      </TouchableOpacity>
    </View>
  );
};

export default function App() {
  const [session, setSession] = useState(null);
  const [authError, setAuthError] = useState("");
  const [state, setState] = useState({ settings: { taxRate: 0 }, products: [], sales: [] });
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState("0");
  const [catalogQtyDrafts, setCatalogQtyDrafts] = useState({});
  const [lorry, setLorry] = useState("");
  const [paymentType, setPaymentType] = useState("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [creditDueDate, setCreditDueDate] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [message, setMessage] = useState("");
  const [printerAddress, setPrinterAddress] = useState("");
  const [printerName, setPrinterName] = useState("");
  const [printerScanning, setPrinterScanning] = useState(false);
  const [printerBusy, setPrinterBusy] = useState(false);
  const [printerDevices, setPrinterDevices] = useState([]);
  const [showPrinterPicker, setShowPrinterPicker] = useState(false);
  const [lastSale, setLastSale] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PRINTER_STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved?.address) {
          setPrinterAddress(saved.address);
          setPrinterName(saved.name || saved.address);
        }
      } catch {
        // ignore corrupt/missing storage - user can just reconnect
      }
    })();
  }, []);

  const scanForPrinters = async () => {
    const printer = getThermalPrinter();
    if (!printer) {
      setMessage("Bluetooth printing isn't available here (e.g. Expo Go) - install the dev client build to use it.");
      return;
    }
    try {
      const hasPermission = await requestBluetoothPermissions();
      if (!hasPermission) {
        setMessage("Bluetooth permission is required to find the printer.");
        return;
      }
      setPrinterScanning(true);
      const { paired = [], found = [] } = await printer.scanDevices();
      const seen = new Set();
      const devices = [...paired, ...found].filter((device) => {
        const key = String(device?.address || "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setPrinterDevices(devices);
      setShowPrinterPicker(true);
    } catch (error) {
      setMessage(error.message || "Unable to scan for printers.");
    } finally {
      setPrinterScanning(false);
    }
  };

  const selectPrinter = async (device) => {
    const address = toPrinterAddress(device);
    if (!address) return;
    setPrinterAddress(address);
    setPrinterName(device.name || address);
    setShowPrinterPicker(false);
    try {
      await AsyncStorage.setItem(PRINTER_STORAGE_KEY, JSON.stringify({ address, name: device.name || "" }));
    } catch {
      // non-fatal - printer still works this session, just won't persist
    }
    setMessage(`Printer connected: ${device.name || address}`);
  };

  const printReceipt = async (sale) => {
    if (!sale) return;
    const printer = getThermalPrinter();
    if (!printer) {
      setMessage("Bluetooth printing isn't available here (e.g. Expo Go) - install the dev client build to use it.");
      return;
    }
    if (!printerAddress) {
      setMessage("Connect a printer first.");
      return;
    }
    try {
      setPrinterBusy(true);
      const result = await printer.printReceipt({
        printers: [{
          address: printerAddress,
          options: { paperWidthMm: 80, encoding: "utf8" }
        }],
        documents: [buildReceiptDocument(sale)]
      });
      if (!result?.success) {
        throw new Error("Printer did not confirm the print job.");
      }
      setMessage(`Printed receipt for ${sale.id}.`);
    } catch (error) {
      setMessage(error.message || "Unable to print receipt.");
    } finally {
      setPrinterBusy(false);
    }
  };

  const refreshSession = async () => {
    if (!session?.refreshToken) return null;
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    if (!response.ok) return null;
    const next = await response.json();
    setSession(next);
    return next;
  };

  const fetchJson = async (path, init = {}, retry = true) => {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        ...(init.headers || {})
      },
      ...init
    });

    if (!response.ok) {
      if (response.status === 401 && retry && session?.refreshToken && path !== "/auth/refresh" && path !== "/auth/login") {
        const next = await refreshSession();
        if (next) {
          return fetchJson(path, init, false);
        }
      }

      const body = await response.json().catch(() => ({}));
      const error = new Error(body.message || `Request failed ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  const effectiveCartLines = useMemo(
    () => cart.map((line) => ({ ...line, price: lineFinalPrice(line) })),
    [cart]
  );
  const totals = useMemo(
    () => calculateTotals({ lines: effectiveCartLines, discount: Number(discount || 0), taxRate: 0 }),
    [effectiveCartLines, discount]
  );

  useEffect(() => {
    if (!session) return undefined;
    let active = true;

    const load = async () => {
      try {
        const freshState = await fetchJson("/state");
        if (active) setState(freshState);
      } catch (error) {
        if (active) {
          if (error.status === 401) setSession(null);
          setMessage(error.message);
        }
      }
    };
    load();

    const socket = io(API_BASE, {
      transports: ["websocket", "polling"],
      auth: { token: session.accessToken }
    });
    socket.on(SOCKET_EVENTS.STATE_SYNC, (next) => {
      if (active) setState(next);
    });

    return () => {
      active = false;
      socket.disconnect();
    };
  }, [session?.accessToken]);

  useEffect(() => {
    if (paymentType !== "cash") setCashReceived("");
    if (paymentType !== "credit") setCreditDueDate("");
  }, [paymentType]);

  const login = async ({ username, password }) => {
    const cleanUsername = (username || "").trim();
    const cleanPassword = (password || "").trim();
    if (!cleanUsername || !cleanPassword) {
      setAuthError("Enter username and password.");
      return;
    }

    try {
      const attempts = ["admin", "cashier"];
      let body = null;
      let ok = false;
      for (const role of attempts) {
        const result = await fetch(`${API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, username: cleanUsername, password: cleanPassword })
        });
        body = await result.json().catch(() => ({}));
        if (result.ok) {
          ok = true;
          break;
        }
      }
      if (!ok) throw new Error("Invalid credentials");
      setSession(body);
      setAuthError("");
    } catch (error) {
      const networkError = error?.message?.toLowerCase().includes("network request failed");
      if (networkError) {
        setAuthError(`Cannot reach server at ${API_BASE}. Check EXPO_PUBLIC_API_BASE and ensure server is running.`);
      } else {
        setAuthError(error.message || "Login failed");
      }
    }
  };

  const logout = async () => {
    try {
      if (session?.refreshToken) {
        await fetch(`${API_BASE}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: session.refreshToken })
        });
      }
    } catch { }
    setSession(null);
    setCart([]);
    setMessage("");
  };

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return state.products;
    return state.products.filter((p) =>
      p.name.toLowerCase().includes(term)
      || p.sku.toLowerCase().includes(term)
      || String(p.size || "").toLowerCase().includes(term)
      || productDisplayName(p).toLowerCase().includes(term)
    );
  }, [search, state.products]);
  const cartQtyByProduct = useMemo(() => {
    const map = new Map();
    for (const line of (cart || [])) {
      map.set(line.productId, (map.get(line.productId) || 0) + Number(line.quantity || 0));
    }
    return map;
  }, [cart]);

  const getCatalogStock = (product) => {
    const currentStock = Number(product?.stock || 0);
    const reserved = Number(cartQtyByProduct.get(product?.id) || 0);
    return Math.max(0, currentStock - reserved);
  };

  const savedCustomers = useMemo(() => {
    return [...(state.customers || [])].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [state.customers]);
  const selectedSavedCustomer = useMemo(() => {
    const key = String(customerName || "").trim().toLowerCase();
    if (!key) return null;
    return (state.customers || []).find((item) => String(item.name || "").trim().toLowerCase() === key) || null;
  }, [customerName, state.customers]);
  const customerOutstandingMap = useMemo(() => {
    const map = new Map();
    for (const sale of (state.sales || [])) {
      const key = String(sale.customerName || "").trim();
      if (!key || key.toLowerCase() === "walk-in") continue;
      const outstanding = Number(
        sale.outstandingAmount !== undefined
          ? sale.outstandingAmount
          : (sale.paymentType === "credit" ? sale.total : 0)
      ) || 0;
      if (outstanding > 0) {
        map.set(key, (map.get(key) || 0) + outstanding);
      }
    }
    return map;
  }, [state.sales]);
  const selectedCustomerOutstanding = useMemo(() => {
    const key = String(customerName || "").trim();
    if (!key) return 0;
    return Number(customerOutstandingMap.get(key) || 0);
  }, [customerName, customerOutstandingMap]);

  const customerOptions = useMemo(() => {
    const term = (customerName || "").trim().toLowerCase();
    const names = [...new Set((state.customers || []).map((item) => String(item.name || "").trim()).filter(Boolean))];
    if (!term) return [];
    return names.filter((name) => name.toLowerCase().includes(term)).slice(0, 8);
  }, [customerName, state.customers]);

  const add = (product) => {
    if (getCatalogStock(product) <= 0) return;
    Vibration.vibrate([0, 16, 10, 18]);
    const requested = Math.floor(Number(catalogQtyDrafts[product.id] || 1));
    const requestQty = Number.isFinite(requested) && requested > 0 ? requested : 1;
    setCart((current) => {
      const index = current.findIndex((line) => line.productId === product.id);
      const alreadyInCart = index === -1 ? 0 : Number(current[index].quantity || 0);
      const available = Math.max(0, Number(product.stock || 0) - alreadyInCart);
      if (available <= 0) return current;
      const addQty = Math.min(available, requestQty);
      if (index === -1) return [...current, { productId: product.id, name: productDisplayName(product), quantity: addQty, basePrice: productSalePrice(product), itemDiscount: 0, price: productSalePrice(product) }];
      const clone = [...current];
      clone[index] = { ...clone[index], quantity: clone[index].quantity + addQty };
      return clone;
    });
    setCatalogQtyDrafts((current) => ({ ...current, [product.id]: "" }));
  };

  const updateQty = (productId, nextQty) => {
    if (nextQty === "") return;
    const parsed = Number(nextQty);
    if (!Number.isFinite(parsed)) return;
    const safeQty = Math.floor(parsed);
    if (safeQty <= 0) {
      setCart((current) => current.filter((line) => line.productId !== productId));
      return;
    }
    setCart((current) => current.map((line) => (line.productId === productId ? { ...line, quantity: safeQty } : line)));
  };
  const updateItemDiscount = (productId, value) => {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setCart((current) => current.map((line) => {
      if (line.productId !== productId) return line;
      const base = lineBasePrice(line);
      return { ...line, itemDiscount: Math.min(parsed, base) };
    }));
  };
  const checkout = async () => {
    const cashier = session?.user?.username || "";
    try {
      if (!selectedSavedCustomer) {
        setMessage("Select a saved customer before checkout.");
        return;
      }
      if (!lorry) {
        setMessage("Select a delivery lorry.");
        return;
      }
      if (paymentType === "cash") {
        const paid = Number(cashReceived || 0);
        if (!Number.isFinite(paid) || paid < 0) {
          setMessage("Cash received must be 0 or more.");
          return;
        }
      }
      if (paymentType === "credit" && !creditDueDate) {
        setMessage("Select credit due date.");
        return;
      }
      const sale = await fetchJson("/sales", {
        method: "POST",
        body: JSON.stringify({
          cashier,
          customerName,
          customerPhone: selectedSavedCustomer?.phone || undefined,
          lorry,
          orderType: "direct",
          paymentType,
          cashReceived: paymentType === "cash" ? Number(cashReceived || 0) : undefined,
          creditDueDate: paymentType === "credit" ? creditDueDate : undefined,
          discount: Number(discount || 0),
          taxRate: 0,
          lines: effectiveCartLines
        })
      });
      setMessage(`Sale ${sale.id} posted. ${currency(sale.total)}`);
      setLastSale(sale);
      setCart([]);
      setDiscount("0");
      setCashReceived("");
      setCreditDueDate("");
    } catch (error) {
      setMessage(error.message);
    }
  };

  if (!session) {
    return (
      <View style={styles.app}>
        <StatusBar style="dark" />
        <LoginScreen onSubmit={login} error={authError} apiBase={API_BASE} />
      </View>
    );
  }

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />
      <View style={styles.topRow}>
        <Image source={require("./assets/lucky-logo.png")} style={styles.topLogo} resizeMode="contain" />
        <Text style={styles.title}>Lucky POS - Android ({session.user?.role})</Text>
        <TouchableOpacity onPress={logout} style={styles.logout}>
          <Text style={styles.logoutLabel}>Logout</Text>
        </TouchableOpacity>
      </View>
      {message ? <Text style={styles.notice}>{message}</Text> : null}
      <View style={styles.printerRow}>
        <Text style={styles.printerStatusText}>
          Printer: {printerName || "Not connected"}
        </Text>
        <TouchableOpacity style={styles.smallButton} onPress={scanForPrinters} disabled={printerScanning}>
          <Text style={styles.smallButtonLabel}>{printerScanning ? "Scanning..." : printerAddress ? "Change" : "Connect"}</Text>
        </TouchableOpacity>
      </View>
      <Modal visible={showPrinterPicker} transparent animationType="fade" onRequestClose={() => setShowPrinterPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.heading}>Select Printer</Text>
            {printerDevices.length ? printerDevices.map((device) => (
              <TouchableOpacity
                key={device.address}
                style={styles.item}
                onPress={() => selectPrinter(device)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{device.name || "Unnamed device"}</Text>
                  <Text style={styles.itemMeta}>{device.address}</Text>
                </View>
              </TouchableOpacity>
            )) : <Text style={styles.itemMeta}>No devices found. Make sure the printer is on and paired in Android Bluetooth settings.</Text>}
            <TouchableOpacity style={styles.secondary} onPress={() => setShowPrinterPicker(false)}>
              <Text style={styles.secondaryLabel}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.heading}>Checkout</Text>
          <Text style={styles.meta}>Cashier: {session.user?.username || "-"}</Text>
          {lastSale ? (
            <TouchableOpacity style={styles.secondary} onPress={() => printReceipt(lastSale)} disabled={printerBusy}>
              <Text style={styles.secondaryLabel}>
                {printerBusy ? "Printing..." : `Print Receipt (${lastSale.id})`}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TextInput value={customerName} onChangeText={setCustomerName} placeholder="Customer" style={styles.input} />
          {customerName.trim() ? <Text style={styles.outstandingText}>Outstanding: {currency(selectedCustomerOutstanding)}</Text> : null}
          {customerOptions.length ? (
            <View style={styles.suggestBox}>
              {customerOptions.map((name) => (
                <TouchableOpacity key={name} style={styles.suggestItem} onPress={() => setCustomerName(name)}>
                  <Text style={styles.suggestText}>
                    {name}
                    {customerOutstandingMap.get(name) ? <Text style={styles.outstandingText}> • OS {currency(customerOutstandingMap.get(name))}</Text> : ""}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {customerName.trim() && !selectedSavedCustomer ? <Text style={styles.outstandingText}>Select an existing saved customer.</Text> : null}
          <TextInput value={discount} onChangeText={setDiscount} placeholder="Bill Discount" keyboardType="numeric" style={styles.input} />
          <Text style={styles.meta}>Delivery lorry</Text>
          <View style={styles.row}>
            {ORDER_LORRIES.map((name) => (
              <TouchableOpacity key={name} onPress={() => setLorry(name)} style={[styles.chip, lorry === name && styles.chipActive]}>
                <Text style={lorry === name ? styles.chipLabelActive : styles.chipLabel}>{name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.row}>
            {PAYMENT_TYPES.map((type) => (
              <TouchableOpacity key={type} onPress={() => setPaymentType(type)} style={[styles.chip, paymentType === type && styles.chipActive]}>
                <Text style={paymentType === type ? styles.chipLabelActive : styles.chipLabel}>{type}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {paymentType === "cash" ? (
            <TextInput
              value={cashReceived}
              onChangeText={setCashReceived}
              placeholder="Cash received"
              keyboardType="numeric"
              style={styles.input}
            />
          ) : null}
          {paymentType === "credit" ? (
            <>
              <Text style={styles.meta}>Credit due date</Text>
              <TextInput
                value={creditDueDate}
                onChangeText={setCreditDueDate}
                placeholder="YYYY-MM-DD"
                style={styles.input}
              />
            </>
          ) : null}
          <View style={styles.totalsBox}>
            <Text style={styles.totalsLine}>Subtotal: {currency(totals.subTotal)}</Text>
            <Text style={styles.totalsLine}>Discount: {currency(totals.discountAmount)}</Text>
            <Text style={styles.total}>Total: {currency(totals.total)}</Text>
          </View>
          <TouchableOpacity style={styles.primary} onPress={checkout} disabled={!cart.length}>
            <Text style={styles.primaryLabel}>Complete Sale</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Catalog</Text>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search products" style={styles.input} />
          {filtered.map((product) => {
            const catalogStock = getCatalogStock(product);
            return (
              <View key={product.id} style={styles.item}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{productDisplayName(product)}</Text>
                  <Text style={styles.itemMeta}>{product.sku} - {currency(productSalePrice(product))} - Stock {catalogStock}</Text>
                </View>
                <View style={styles.catalogAddWrap}>
                  <TextInput
                    value={catalogQtyDrafts[product.id] ?? ""}
                    onChangeText={(value) => setCatalogQtyDrafts((current) => ({ ...current, [product.id]: value }))}
                    keyboardType="numeric"
                    placeholder="Qty"
                    style={styles.catalogQtyInput}
                  />
                  <Pressable
                    style={({ pressed }) => [styles.smallButton, catalogStock <= 0 && styles.smallButtonDisabled, pressed && styles.smallButtonPressed]}
                    onPressIn={() => {
                      if (catalogStock > 0) Vibration.vibrate(10);
                    }}
                    onPress={() => add(product)}
                    disabled={catalogStock <= 0}
                  >
                    <Text style={styles.smallButtonLabel}>Add</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Cart</Text>
          {cart.map((line) => (
            <View key={line.productId} style={[styles.item, styles.cartItem]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{line.name}</Text>
                <Text style={styles.itemMeta}>{currency(lineBasePrice(line))} x {line.quantity}</Text>
                <TextInput
                  value={String(line.itemDiscount ?? 0)}
                  onChangeText={(value) => updateItemDiscount(line.productId, value)}
                  placeholder="Item Disc"
                  keyboardType="numeric"
                  style={styles.itemDiscountInput}
                />
                <Text style={styles.itemMeta}>Item Discount (Rs.)</Text>
                <Text style={styles.itemMeta}>Net {currency(lineFinalPrice(line))} each</Text>
              </View>
              <View style={styles.qtyWrap}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(line.productId, line.quantity - 1)}>
                  <Text>-</Text>
                </TouchableOpacity>
                <Text>{line.quantity}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(line.productId, line.quantity + 1)}>
                  <Text>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Saved Customers</Text>
          {savedCustomers.length ? savedCustomers.map((customer) => (
            <View key={customer.id} style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{customer.name}</Text>
                <Text style={styles.itemMeta}>{customer.phone || "-"}</Text>
                <Text style={styles.itemMeta}>{customer.address || "-"}</Text>
                <Text style={styles.outstandingText}>Outstanding: {currency(customerOutstandingMap.get(customer.name) || 0)}</Text>
              </View>
            </View>
          )) : <Text style={styles.itemMeta}>No saved customers yet.</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: "#000000", paddingTop: 42 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16 },
  topLogo: { width: 32, height: 32, marginRight: 8 },
  title: { fontSize: 18, fontWeight: "700", color: "#083d77", flex: 1, paddingRight: 8 },
  logout: { backgroundColor: "#113a60", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  logoutLabel: { color: "#fff", fontWeight: "700", fontSize: 12 },
  content: { padding: 12, gap: 12 },
  notice: { marginHorizontal: 16, marginTop: 6, backgroundColor: "#d5ebff", padding: 8, borderRadius: 8, color: "#0d4d86" },
  printerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginHorizontal: 16, marginTop: 6, gap: 8 },
  printerStatusText: { color: "#34516d", fontWeight: "600", flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 8, maxHeight: "80%" },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 12, gap: 8, borderColor: "#cad6e2", borderWidth: 1 },
  heading: { fontSize: 17, fontWeight: "700", color: "#19324d" },
  meta: { color: "#34516d", fontWeight: "600" },
  input: { borderColor: "#cad6e2", borderWidth: 1, borderRadius: 10, padding: 10, backgroundColor: "#fff" },
  suggestBox: { borderColor: "#cad6e2", borderWidth: 1, borderRadius: 10, backgroundColor: "#fff", overflow: "hidden" },
  suggestItem: { paddingHorizontal: 10, paddingVertical: 8, borderBottomColor: "#e3ebf4", borderBottomWidth: 1 },
  suggestText: { color: "#12314f" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: "#a9bfd8", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10 },
  chipActive: { backgroundColor: "#005cb9", borderColor: "#005cb9" },
  chipLabel: { color: "#204565" },
  chipLabelActive: { color: "#fff" },
  totalsBox: { borderWidth: 2, borderColor: "#1d4ed8", borderRadius: 12, backgroundColor: "#eef4ff", paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
  totalsLine: { color: "#1f3b5d", fontWeight: "600" },
  total: { fontSize: 19, fontWeight: "700", color: "#1e3a8a" },
  primary: { backgroundColor: "#c2410c", paddingVertical: 11, borderRadius: 10, alignItems: "center" },
  primaryLabel: { color: "#fff", fontWeight: "700" },
  secondary: { backgroundColor: "#116149", paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  secondaryLabel: { color: "#fff", fontWeight: "700" },
  item: { flexDirection: "row", alignItems: "center", borderColor: "#d6e2ee", borderWidth: 1, borderRadius: 10, padding: 8, gap: 8 },
  cartItem: { backgroundColor: "#eceff3", borderColor: "#ccd5df" },
  itemName: { fontWeight: "600", color: "#112f4f" },
  itemMeta: { color: "#4c647e", fontSize: 12 },
  itemDiscountInput: { marginTop: 4, width: 110, borderWidth: 1, borderColor: "#c8d7e8", borderRadius: 6, paddingVertical: 4, paddingHorizontal: 6, backgroundColor: "#fff" },
  outstandingText: { color: "#b91c1c", fontWeight: "700", fontSize: 12 },
  smallButton: { backgroundColor: "#005cb9", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  smallButtonDisabled: { backgroundColor: "#8fa7c2" },
  smallButtonPressed: { backgroundColor: "#004d99", transform: [{ scale: 0.96 }] },
  smallButtonLabel: { color: "#fff", fontWeight: "600" },
  catalogAddWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  catalogQtyInput: { width: 52, borderWidth: 1, borderColor: "#aac3de", borderRadius: 6, textAlign: "center", paddingVertical: 4, paddingHorizontal: 4, backgroundColor: "#fff" },
  qtyWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyBtn: { borderWidth: 1, borderColor: "#aac3de", borderRadius: 6, width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  loginWrap: { flex: 1, paddingHorizontal: 16, paddingTop: 60, gap: 10 },
  mobileLogo: { width: 74, height: 74, marginBottom: 6 },
  loginTitle: { fontSize: 28, fontWeight: "800", color: "#0f365f" },
  loginSub: { color: "#4d6781", marginBottom: 8 },
  loginFieldLabel: { color: "#334e68", fontWeight: "700", marginTop: 4 },
  loginHint: { color: "#6b7280", fontSize: 12 },
  loginRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  loginChip: { borderWidth: 1, borderColor: "#99b4d0", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999 },
  loginChipActive: { backgroundColor: "#005cb9", borderColor: "#005cb9" },
  loginChipText: { color: "#224462" },
  loginChipTextActive: { color: "#fff", fontWeight: "700" },
  loginError: { color: "#b91c1c", fontWeight: "600" }
});
