package com.ruslan.tvremote;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Samsung Smart TV (Tizen) control over the local network.
 * - discover(): SSDP + subnet probe on port 8001, verified via http://IP:8001/api/v2/
 * - connect():  WebSocket to the TV remote channel (wss 8002 with self-signed cert, or ws 8001)
 * - sendKey():  sends a remote key (e.g. KEY_VOLUP)
 */
@CapacitorPlugin(name = "SamsungTv")
public class SamsungTvPlugin extends Plugin {

    private final ExecutorService exec = Executors.newCachedThreadPool();
    private OkHttpClient wsClient;
    private OkHttpClient httpClient;
    private volatile WebSocket socket;
    private volatile int connId = 0;

    @Override
    public void load() {
        wsClient = buildClient(5, 0, true);
        httpClient = buildClient(1, 2, false);
    }

    /** The TV uses a self-signed certificate on port 8002, so trust it for this local connection only. */
    private OkHttpClient buildClient(int connectSec, int readSec, boolean ping) {
        OkHttpClient.Builder b = new OkHttpClient.Builder()
                .connectTimeout(connectSec, TimeUnit.SECONDS)
                .readTimeout(readSec, TimeUnit.SECONDS);
        if (ping) b.pingInterval(20, TimeUnit.SECONDS);
        try {
            final X509TrustManager tm = new X509TrustManager() {
                @Override public void checkClientTrusted(X509Certificate[] chain, String authType) { }
                @Override public void checkServerTrusted(X509Certificate[] chain, String authType) { }
                @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            };
            SSLContext ssl = SSLContext.getInstance("TLS");
            ssl.init(null, new TrustManager[]{tm}, new SecureRandom());
            b.sslSocketFactory(ssl.getSocketFactory(), tm);
            b.hostnameVerifier((host, session) -> true);
        } catch (Exception ignored) { }
        return b.build();
    }

    private void emit(String type, String key, String value) {
        JSObject o = new JSObject();
        o.put("type", type);
        if (key != null) o.put(key, value);
        notifyListeners("tvEvent", o);
    }

    // ------------------------------------------------------------------ connect

    @PluginMethod
    public void connect(PluginCall call) {
        String ip = call.getString("ip");
        Integer portObj = call.getInt("port", 8002);
        int port = portObj == null ? 8002 : portObj;
        String name = call.getString("name", "Remote");
        String token = call.getString("token", "");
        if (ip == null || ip.isEmpty()) { call.reject("IP gerekli"); return; }

        closeSocket();
        final int myId = ++connId;

        String nameB64 = Base64.encodeToString(name.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP)
                .replace("+", "%2B").replace("/", "%2F").replace("=", "%3D");
        String url = (port == 8002 ? "wss://" : "ws://") + ip + ":" + port
                + "/api/v2/channels/samsung.remote.control?name=" + nameB64
                + (token != null && !token.isEmpty() ? "&token=" + token : "");

        Request req = new Request.Builder().url(url).build();
        socket = wsClient.newWebSocket(req, new WebSocketListener() {
            @Override public void onOpen(WebSocket ws, Response response) {
                if (myId == connId) emit("open", null, null);
            }
            @Override public void onMessage(WebSocket ws, String text) {
                if (myId != connId) return;
                try {
                    JSONObject j = new JSONObject(text);
                    String ev = j.optString("event");
                    if ("ms.channel.connect".equals(ev)) {
                        JSONObject data = j.optJSONObject("data");
                        String tok = data != null ? data.optString("token", "") : "";
                        emit("connected", "token", tok);
                    } else if ("ms.channel.unauthorized".equals(ev)) {
                        emit("unauthorized", null, null);
                    } else if ("ms.channel.timeOut".equals(ev)) {
                        emit("timeout", null, null);
                    }
                } catch (Exception ignored) { }
            }
            @Override public void onClosing(WebSocket ws, int code, String reason) {
                ws.close(1000, null);
            }
            @Override public void onClosed(WebSocket ws, int code, String reason) {
                if (myId == connId) { socket = null; emit("closed", null, null); }
            }
            @Override public void onFailure(WebSocket ws, Throwable t, Response response) {
                if (myId == connId) {
                    socket = null;
                    emit("error", "message", t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName());
                    emit("closed", null, null);
                }
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void sendKey(PluginCall call) {
        String key = call.getString("key");
        WebSocket ws = socket;
        if (ws == null || key == null) { call.reject("TV bağlı değil"); return; }
        try {
            JSONObject params = new JSONObject();
            params.put("Cmd", "Click");
            params.put("DataOfCmd", key);
            params.put("Option", "false");
            params.put("TypeOfRemote", "SendRemoteKey");
            JSONObject msg = new JSONObject();
            msg.put("method", "ms.remote.control");
            msg.put("params", params);
            if (ws.send(msg.toString())) call.resolve(); else call.reject("Gönderilemedi");
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeSocket();
        call.resolve();
    }

    private void closeSocket() {
        connId++; // ignore events from the old socket
        WebSocket ws = socket;
        socket = null;
        if (ws != null) { try { ws.close(1000, "bye"); } catch (Exception ignored) { } }
    }

    // ----------------------------------------------------------------- discover

    @PluginMethod
    public void discover(PluginCall call) {
        final int timeout = call.getInt("timeout", 3000);
        exec.execute(() -> {
            try {
                Set<String> candidates = new LinkedHashSet<>();
                String local = localIpv4();
                String subnet = local != null ? local.substring(0, local.lastIndexOf('.')) : null;

                // 1) SSDP and 2) subnet port probe run in parallel
                Future<?> ssdp = exec.submit(() -> {
                    Set<String> s = ssdpSearch(timeout);
                    synchronized (candidates) { candidates.addAll(s); }
                });
                if (subnet != null) {
                    List<String> open = probeSubnet(subnet, local);
                    synchronized (candidates) { candidates.addAll(open); }
                }
                try { ssdp.get(timeout + 2000, TimeUnit.MILLISECONDS); } catch (Exception ignored) { }

                // 3) verify each candidate is a Samsung TV
                List<String> list;
                synchronized (candidates) { list = new ArrayList<>(candidates); }
                List<Future<JSObject>> checks = new ArrayList<>();
                for (String ip : list) checks.add(exec.submit(() -> verifyTv(ip)));
                JSArray devices = new JSArray();
                for (Future<JSObject> f : checks) {
                    try {
                        JSObject d = f.get(4, TimeUnit.SECONDS);
                        if (d != null) devices.put(d);
                    } catch (Exception ignored) { }
                }
                JSObject ret = new JSObject();
                ret.put("devices", devices);
                ret.put("subnet", subnet);
                ret.put("localIp", local);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Tarama hatası");
            }
        });
    }

    private Set<String> ssdpSearch(int timeoutMs) {
        Set<String> found = new LinkedHashSet<>();
        WifiManager.MulticastLock lock = null;
        try {
            WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                lock = wm.createMulticastLock("tvremote-ssdp");
                lock.setReferenceCounted(false);
                lock.acquire();
            }
        } catch (Exception ignored) { }
        try (DatagramSocket sock = new DatagramSocket()) {
            sock.setSoTimeout(400);
            InetAddress group = InetAddress.getByName("239.255.255.250");
            String[] targets = {
                    "urn:samsung.com:device:RemoteControlReceiver:1",
                    "urn:dial-multiscreen-org:service:dial:1",
                    "urn:schemas-upnp-org:device:MediaRenderer:1"
            };
            for (int round = 0; round < 2; round++) {
                for (String st : targets) {
                    String msg = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + st + "\r\n\r\n";
                    byte[] b = msg.getBytes(StandardCharsets.US_ASCII);
                    sock.send(new DatagramPacket(b, b.length, group, 1900));
                }
            }
            long end = System.currentTimeMillis() + timeoutMs;
            byte[] buf = new byte[4096];
            while (System.currentTimeMillis() < end && found.size() < 64) {
                try {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    sock.receive(p);
                    InetAddress a = p.getAddress();
                    if (a instanceof Inet4Address) found.add(a.getHostAddress());
                } catch (java.net.SocketTimeoutException ignored) { }
            }
        } catch (Exception ignored) {
        } finally {
            if (lock != null) try { lock.release(); } catch (Exception ignored) { }
        }
        return found;
    }

    private List<String> probeSubnet(String subnet, String self) {
        List<String> open = Collections.synchronizedList(new ArrayList<>());
        ExecutorService pool = Executors.newFixedThreadPool(48);
        for (int i = 1; i < 255; i++) {
            final String ip = subnet + "." + i;
            if (ip.equals(self)) continue;
            pool.execute(() -> {
                try (Socket s = new Socket()) {
                    s.connect(new InetSocketAddress(ip, 8001), 350);
                    open.add(ip);
                } catch (Exception ignored) { }
            });
        }
        pool.shutdown();
        try { pool.awaitTermination(8, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
        return new ArrayList<>(open);
    }

    private JSObject verifyTv(String ip) {
        Request req = new Request.Builder().url("http://" + ip + ":8001/api/v2/").build();
        try (Response r = httpClient.newCall(req).execute()) {
            if (!r.isSuccessful() || r.body() == null) return null;
            JSONObject j = new JSONObject(r.body().string());
            JSONObject dev = j.optJSONObject("device");
            if (dev == null) return null;
            JSObject o = new JSObject();
            o.put("ip", ip);
            String name = dev.optString("name", j.optString("name", "Samsung TV"));
            o.put("name", name.replace("[TV] ", "").trim().isEmpty() ? "Samsung TV" : name);
            o.put("model", dev.optString("modelName", ""));
            o.put("mac", dev.optString("wifiMac", ""));
            o.put("power", dev.optString("PowerState", ""));
            return o;
        } catch (Exception e) {
            return null;
        }
    }

    private String localIpv4() {
        String fallback = null;
        try {
            Enumeration<NetworkInterface> ifs = NetworkInterface.getNetworkInterfaces();
            while (ifs != null && ifs.hasMoreElements()) {
                NetworkInterface ni = ifs.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        String ip = a.getHostAddress();
                        String n = ni.getName() == null ? "" : ni.getName();
                        if (n.startsWith("wlan") || n.startsWith("eth")) return ip;
                        if (fallback == null) fallback = ip;
                    }
                }
            }
        } catch (Exception ignored) { }
        return fallback;
    }

    @Override
    protected void handleOnDestroy() {
        closeSocket();
        exec.shutdownNow();
        super.handleOnDestroy();
    }
}
