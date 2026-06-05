# Making YouTube transcripts work on a VPS (the datacenter-IP block)

If you run yt-briefing on your laptop, you can skip this — residential IPs fetch
transcripts fine, no proxy needed. This is for when you move it to a server.

## The problem

YouTube **structurally blocks datacenter IPs** — OVH, AWS, GCP, Azure, Scaleway, the lot.
From the very first request you get `429` or *"Sign in to confirm you're not a bot."* It
is not a temporary rate-limit you can wait out; whole cloud CIDR ranges are blocked. On a
VPS without a proxy, every sweep returns `rate_limited` for every video → zero transcripts.

## The fix: Cloudflare WARP as a proxy

Route the transcript fetch through Cloudflare WARP. The egress IP becomes Cloudflare's
CDN — a global CDN, not a datacenter range — which YouTube does not block. It's free and
there are no credentials to babysit (the WARP registration lives in a Docker volume).

### One-time setup

```bash
docker run -d \
  --name warp \
  --restart unless-stopped \
  --device-cgroup-rule 'c 10:200 rwm' \
  --cap-add MKNOD --cap-add AUDIT_WRITE --cap-add NET_ADMIN \
  --sysctl net.ipv6.conf.all.disable_ipv6=0 \
  --sysctl net.ipv4.conf.all.src_valid_mark=1 \
  -p 127.0.0.1:1080:1080 \
  -v warp-data:/var/lib/cloudflare-warp \
  caomingjun/warp
```

The `caomingjun/warp` image exposes both HTTP and SOCKS5 on port 1080 — yt-dlp handles
either; we use HTTP.

### Point yt-briefing at it

```bash
# .env
YT_PROXY=http://127.0.0.1:1080
```

`src/yt-transcript.ts` reads `YT_PROXY` and routes all yt-dlp traffic through it. No env
var → direct fetch (the residential default).

### Health check

```bash
curl --proxy http://127.0.0.1:1080 https://www.cloudflare.com/cdn-cgi/trace | grep warp=
# expect: warp=on
```

## Recovery

If the container stops, transcripts return `rate_limited` again:

```bash
docker start warp
```

### "It worked all day, then suddenly rate_limited"

YouTube blocked the specific Cloudflare egress IP WARP happened to use (the block is
per-IP, not per-account). Force a re-registration to get a fresh egress IP:

```bash
# 1. See the current egress IP and whether YouTube blocks it:
curl -x http://127.0.0.1:1080 -s https://api.ipify.org
curl -x http://127.0.0.1:1080 -s -o /dev/null -w "%{http_code}\n" "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
# 200 = OK, 429 = this IP is blocked

# 2. Re-register → new egress IP:
docker exec warp warp-cli registration delete 2>/dev/null; true
docker exec warp warp-cli registration new
docker exec warp warp-cli connect
sleep 5
curl -x http://127.0.0.1:1080 -s https://api.ipify.org   # should differ
```

Then re-run the sweep.
