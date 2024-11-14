const fs = require('fs');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const colors = require('colors');

class ProxyChecker {
    constructor() {
      this.config = {
        ipCheckURL: 'https://ipinfo.io/json',
        timeout: 6000,    // Timeout set to 5 seconds
        maxRetries: 0     // Retry each proxy up to 2 times if it fails initially
      };
      this.workingProxies = new Set();
      this.completedChecks = 0;
      this.totalChecks = 0;
      this.maxConcurrency = 800; // Limit the number of concurrent proxy checks
    }
  
    async checkProxy(proxyUrl, retries = 0) {
        // console.log(`Checking proxy: ${proxyUrl}, Attempt ${retries + 1}`);
        try {
          const agent = new HttpsProxyAgent(proxyUrl);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
      
          const response = await axios.get(this.config.ipCheckURL, {
            httpsAgent: agent,
            signal: controller.signal,
            timeout: this.config.timeout,
            validateStatus: false
          });
      
          clearTimeout(timeoutId);
      
          if (response.status === 200) {
            this.workingProxies.add(proxyUrl);
          }
      
        } catch (error) {
          if (retries < this.config.maxRetries) {
            console.log(`Retrying proxy: ${proxyUrl}, Attempt ${retries + 2}`);
            return await this.checkProxy(proxyUrl, retries + 1);
          }
        } finally {
          this.completedChecks++;
          console.log(`Completed check for proxy: ${proxyUrl}, Total completed: ${this.completedChecks}`);
          this.logProgress();
        }
      }
      
  
    async processProxyList(proxyApiUrls, outputFile) {
      try {
        const proxyUrls = [];
        for (const url of proxyApiUrls) {
          const response = await axios.get(url);
          proxyUrls.push(
            ...response.data
              .split('\n')
              .map(line => line.replace(/^(socks4|socks5):\/\//, 'http://').trim())
              .filter(line => line.includes(':'))
          );
        }
  
        this.totalChecks = proxyUrls.length;
        console.log(`\nLoaded ${this.totalChecks} proxies from proxies.json`.cyan);
        console.log(`Testing ${this.totalChecks} total connections\n`.cyan);
  
        // Process proxies with controlled concurrency
        for (let i = 0; i < proxyUrls.length; i += this.maxConcurrency) {
          const batch = proxyUrls.slice(i, i + this.maxConcurrency);
          await Promise.all(batch.map(url => this.checkProxy(url)));
        }
  
        const output = Array.from(this.workingProxies).join('\n');
        fs.writeFileSync(outputFile, output);
  
        console.log(`\n\nFound ${this.workingProxies.size} working proxies. Saved to ${outputFile}`.green);
        process.exit();
      } catch (error) {
        console.error(`\nError processing proxy list: ${error.message}`.red);
      }
    }
  
    logProgress() {
      // Ensure the progress is within the total checks limit
      const progress = ((this.completedChecks / this.totalChecks) * 100).toFixed(1);
      process.stdout.write(`\rProgress: ${progress}% (${this.completedChecks}/${this.totalChecks}) - Found ${this.workingProxies.size} working proxies`);
    }
  }
  
  

async function main() {
  try {
    const proxyApiUrls = JSON.parse(fs.readFileSync('proxies.json', 'utf8')).proxyApiUrls;
    const outputFile = 'working_proxies.txt';

    const checker = new ProxyChecker();
    await checker.processProxyList(proxyApiUrls, outputFile);
  } catch (error) {
    console.error(`Fatal error: ${error.message}`.red);
    process.exit(1);
  }
}

main().catch(console.error);
