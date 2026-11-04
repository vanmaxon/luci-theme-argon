'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const test = require('node:test');

test('Waifu wallpapers use live providers by orientation, cache, and fall back', () => {
	const source = fs.readFileSync(path.join(__dirname, '../root/usr/libexec/rpcd/luci.argon_wallpaper'), 'utf8');
	const imports = '. /lib/functions.sh\n. /usr/share/libubox/jshn.sh';
	const stub = `
uci() { case "$*" in *online_wallpaper) echo "$TEST_SOURCE";; *use_api_key) echo test-key;; esac; }
json_load() { case "$1" in *portrait*) input_orientation=portrait;; *landscape*) input_orientation=landscape;; *) input_orientation='';; esac; }
json_get_var() { ORIENTATION="$input_orientation"; }
json_init() { json_url=''; }
json_add_string() { [ "$1" = url ] && json_url="$2"; }
json_dump() { printf '{"url":"%s"}\\n' "$json_url"; }
json_cleanup() { :; }
flock() { return 0; }
wget() {
  printf '%s\\n' "$*" >> "$TEST_REQUESTS"
  [ "$TEST_FAIL" != 1 ] || return 1
  printf '%s\\n' '{"results":[{"url":"https://example.com/waifu.jpg","dimensions":{"width":800,"height":1200}}],"urls":{"regular":"https://example.com/waifu.jpg"},"data":[{"path":"https://example.com/waifu.jpg"}]}'
}
jsonfilter() {
  python3 -c 'import json,sys; d=json.load(sys.stdin); k=sys.argv[1]; print(d["results"][0]["dimensions"]["width"] if "dimensions.width" in k else d["results"][0]["dimensions"]["height"] if "dimensions.height" in k else d["results"][0]["url"] if "results" in k else d["urls"]["regular"] if "urls" in k else d["data"][0]["path"])' "$*" 2>/dev/null
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
			.replace('WRLOCK="/var/lock/argon_${WEB_PIC_SRC}.lock"', 'WRLOCK="$TEST_LOCK"')
			.replace('CACHE="/var/run/argon_${WEB_PIC_SRC}_${ORIENTATION}.url"', 'CACHE="$TEST_CACHE.$ORIENTATION"')
			.replace('WRLOCK="/var/lock/argon_${WEB_PIC_SRC}_${ORIENTATION}.lock"', 'WRLOCK="$TEST_LOCK.$ORIENTATION"'));
		function call(fail = false, orientation = '', source = 'waifu') {
			return JSON.parse(execFileSync('bash', [script, 'call', 'get_url'], {
				input: JSON.stringify({ orientation }) + '\n', encoding: 'utf8',
				env: { ...process.env, TEST_SOURCE: source, TEST_CACHE: cache, TEST_LOCK: path.join(dir, 'lock'), TEST_REQUESTS: requests, TEST_FAIL: fail ? '1' : '0' }
			}));
		}
		assert.deepEqual(call(false, 'landscape'), { url: 'https://example.com/waifu.jpg' });
		assert.deepEqual(call(false, 'portrait'), { url: 'https://example.com/waifu.jpg' });
		assert.match(fs.readFileSync(requests, 'utf8'), /categories=010&purity=100&atleast=1920x1080&ratios=16x9,16x10,21x9/);
		assert.match(fs.readFileSync(requests, 'utf8'), /https:\/\/nekos\.best\/api\/v2\/waifu/);
		assert.deepEqual(call(true, 'landscape'), { url: 'https://example.com/waifu.jpg' });
		assert.equal(fs.readFileSync(requests, 'utf8').trim().split('\n').length, 2);
		fs.rmSync(cache + '.portrait');
		assert.deepEqual(call(true, 'portrait'), { url: '' });
		assert.equal(fs.readFileSync(cache + '.portrait', 'utf8'), '');
		for (const source of ['unsplash', 'wallhaven']) {
			fs.rmSync(cache + '.landscape');
			fs.rmSync(cache + '.portrait');
			fs.rmSync(requests);
			assert.deepEqual(call(false, 'landscape', source), { url: 'https://example.com/waifu.jpg' });
			assert.deepEqual(call(false, 'portrait', source), { url: 'https://example.com/waifu.jpg' });
			const urls = fs.readFileSync(requests, 'utf8');
			if (source === 'unsplash') {
				assert.match(urls, /orientation=landscape/);
				assert.match(urls, /orientation=portrait/);
			} else {
				assert.match(urls, /atleast=1920x1080&ratios=16x9,16x10,21x9/);
				assert.match(urls, /atleast=1080x1920&ratios=9x16,10x16,9x18/);
			}
		}
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
