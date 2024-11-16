const fs = require('fs');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const colors = require('colors');

class QueueBasedProxyChecker {
    constructor(config) {
        this.config = {
            timeout: config.timeout || 5000,
            retryAttempts: config.retryAttempts || 2,
            queueSize: config.queueSize || 200,
            checkInterval: config.checkInterval || 100,
        };
        this.proxyQueue = [];
        this.activeChecks = 0;
        this.workingProxies = [];
        this.failedProxies = new Set();
        this.totalChecks = 0;
        this.completedChecks = 0;
    }

    getAgent(proxyUrl) {
        return proxyUrl.startsWith('socks') ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
    }

    async testProxy(proxyUrl) {
        try {
            const agent = this.getAgent(proxyUrl);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

            const response = await axios.get('https://ipinfo.io/json', {
                httpsAgent: agent,
                signal: controller.signal,
                timeout: this.config.timeout,
                validateStatus: false,
            });

            clearTimeout(timeoutId);

            if (response.status !== 200) {
                throw new Error(`Non-200 response: ${response.status}`);
            }

            // Check if proxy is US-based
            if (response.data.country !== 'US') {
                throw new Error('Non-US proxy');
            }

            return proxyUrl;
        } catch {
            return null;
        }
    }

    async processQueue() {
        while (this.proxyQueue.length > 0 || this.activeChecks > 0) {
            while (this.activeChecks < this.config.queueSize && this.proxyQueue.length > 0) {
                const proxyUrl = this.proxyQueue.shift();
                this.activeChecks++;

                (async () => {
                    let result = null;
                    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
                        result = await this.testProxy(proxyUrl);
                        if (result) break;
                    }

                    if (result) {
                        this.workingProxies.push(result);
                    } else {
                        this.failedProxies.add(proxyUrl);
                    }
                })()
                    .finally(() => {
                        this.activeChecks--;
                        this.completedChecks++;
                        this.logProgress();
                    });
            }

            await new Promise(resolve => setTimeout(resolve, this.config.checkInterval));
        }
    }

    async processProxyList(proxyApiUrls, outputFile) {
        try {
            for (const url of proxyApiUrls) {
                const response = await axios.get(url);
                const proxies = response.data
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.includes(':'));

                this.proxyQueue.push(...proxies);
            }

            this.totalChecks = this.proxyQueue.length;
            console.log(`Loaded ${this.totalChecks} proxies from API.`.cyan);
            console.log(`Starting tests with a queue size of ${this.config.queueSize}.\n`.cyan);

            await this.processQueue();

            // Save just the URLs to a text file
            fs.writeFileSync(outputFile, this.workingProxies.join('\n'), 'utf8');
            
            console.log(`\n\nFound ${this.workingProxies.length} working US proxies. Results saved to ${outputFile}`.green);
            process.exit();
        } catch (error) {
            console.error(`Error processing proxy list: ${error.message}`.red);
        }
    }

    logProgress() {
        const progress = ((this.completedChecks / this.totalChecks) * 100).toFixed(1);
        process.stdout.write(
            `\rProgress: ${progress}% (${this.completedChecks}/${this.totalChecks}) - Active: ${this.activeChecks} - Found: ${this.workingProxies.length} US proxies`
        );
    }
}

async function main() {
    try {
        const proxyApiUrls = JSON.parse(fs.readFileSync('proxies.json', 'utf8')).proxyApiUrls;
        const outputFile = 'working_proxies.txt';
        const config = {
            timeout: 6000,
            retryAttempts: 1,
            queueSize: 400,
            checkInterval: 100,
        };

        const checker = new QueueBasedProxyChecker(config);
        await checker.processProxyList(proxyApiUrls, outputFile);
    } catch (error) {
        console.error(`Fatal error: ${error.message}`.red);
    }
}

main();
