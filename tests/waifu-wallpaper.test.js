'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const test = require('node:test');

test('Waifu.im fetches a SFW image, caches it, and falls back on failure', () => {
	const source = fs.readFileSync(path.join(__dirname, '../root/usr/libexec/rpcd/luci.argon_wallpaper'), 'utf8');
	const imports = '. /lib/functions.sh\n. /usr/share/libubox/jshn.sh';
	const stub = `
uci() { case "$*" in *online_wallpaper) echo waifu;; esac; }
json_init() { json_url=''; }
json_add_string() { [ "$1" = url ] && json_url="$2"; }
json_dump() { printf '{"url":"%s"}\\n' "$json_url"; }
json_cleanup() { :; }
flock() { return 0; }
wget() {
  printf '%s\\n' "$*" >> "$TEST_REQUESTS"
  [ "$TEST_FAIL" != 1 ] || return 1
  printf '%s\\n' '{"items":[{"url":"https://example.com/waifu.jpg"}]}'
}
jsonfilter() {
  [ "$*" = '-qe @.items[0].url' ] || return 1
  python3 -c 'import json,sys; data=json.load(sys.stdin); print(data["items"][0]["url"])' 2>/dev/null
}
`;
	assert.ok(source.includes(imports));
	const dir = fs.mkdtempSync(path.join(tmpdir(), 'argon-waifu-test-'));
	try {
		const script = path.join(dir, 'wallpaper.sh');
		const cache = path.join(dir, 'wallpaper.url');
		const requests = path.join(dir, 'requests');
		fs.writeFileSync(script, source.replace(imports, stub)
			.replace('CACHE="/var/run/argon_${WEB_PIC_SRC}.url"', 'CACHE="$TEST_CACHE"')
			.replace('WRLOCK="/var/lock/argon_${WEB_PIC_SRC}.lock"', 'WRLOCK="$TEST_LOCK"'));
		function call(fail = false) {
			return JSON.parse(execFileSync('bash', [script, 'call', 'get_url'], {
				input: '{}\n', encoding: 'utf8',
				env: { ...process.env, TEST_CACHE: cache, TEST_LOCK: path.join(dir, 'lock'), TEST_REQUESTS: requests, TEST_FAIL: fail ? '1' : '0' }
			}));
		}
		assert.deepEqual(call(), { url: 'https://example.com/waifu.jpg' });
		assert.match(fs.readFileSync(requests, 'utf8'), /https:\/\/api\.waifu\.im\/images\?IsNsfw=False&PageSize=1/);
		assert.deepEqual(call(true), { url: 'https://example.com/waifu.jpg' });
		assert.equal(fs.readFileSync(requests, 'utf8').trim().split('\n').length, 1);
		fs.rmSync(cache);
		assert.deepEqual(call(true), { url: '' });
		assert.equal(fs.readFileSync(cache, 'utf8'), '');
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
