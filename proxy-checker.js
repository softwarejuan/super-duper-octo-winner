const fs = require('fs');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const colors = require('colors');

class ProxyChecker {
  constructor() {
    this.config = {
      ipCheckURL: 'https://ipinfo.io/json',
      timeout: 5000,
      retryDelay: 200,
      maxRetries: 1,
      maxConcurrent: 400
    };
    this.workingProxies = [];
    this.completedChecks = 0;
    this.totalChecks = 0;
  }

  async checkProxy(proxyUrl) {
    let retries = 0;
    while (retries < this.config.maxRetries) {
      try {
        const [protocol, host, port] = proxyUrl.split(':');
        const agent = protocol === 'http'
          ? new HttpsProxyAgent(`${protocol}://${host}:${port}`)
          : new SocksProxyAgent(`${protocol}://${host}:${port}`);

        const response = await axios.get(this.config.ipCheckURL, {
          httpsAgent: agent,
          timeout: this.config.timeout,
          validateStatus: false
        });

        if (response.status === 200) {
          const { city, region, country } = response.data;
          this.workingProxies.push({
            url: proxyUrl,
            country,
            region,
            city
          });
          console.log(`✓ ${proxyUrl} (${country}, ${region}, ${city})`.green);
        } else {
          console.log(`× ${proxyUrl} - Status ${response.status}`.red);
        }
        return;
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          console.log(`× ${proxyUrl} - Connection refused`.red);
        } else if (error.code === 'ETIMEDOUT') {
          console.log(`× ${proxyUrl} - Timeout`.yellow);
        } else {
          console.log(`× ${proxyUrl} - Unknown error: ${error.message}`.red);
        }
        retries++;
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * Math.pow(2, retries))); // Exponential backoff
      }
    }
    console.log(`× ${proxyUrl} - Exceeded maximum retries`.red);
  }

  async processProxyList(proxyApiUrls, outputFile) {
    try {
      const proxyUrls = [];
      for (const url of proxyApiUrls) {
        const response = await axios.get(url);
        proxyUrls.push(...response.data.split('\n').filter(line => line.trim().length > 0));
      }

      this.totalChecks = proxyUrls.length;
      console.log(`\nLoading ${proxyUrls.length} proxies from API URLs`.cyan);
      console.log(`Testing ${this.totalChecks} total connections\n`.cyan);

      const promises = [];
      for (const proxyUrl of proxyUrls) {
        promises.push(this.checkProxy(proxyUrl));
        if (promises.length >= this.config.maxConcurrent) {
          await Promise.allSettled(promises);
          this.completedChecks += promises.length;
          this.updateProgress();
          promises.length = 0;
        }
      }

      // Wait for any remaining checks to complete
      if (promises.length > 0) {
        await Promise.allSettled(promises);
        this.completedChecks += promises.length;
        this.updateProgress();
      }

      // Save results
      const output = this.workingProxies.map(({ url, country, region, city }) => {
        return `${url}`;
      }).join('\n');
      fs.writeFileSync(outputFile, output);
      
      console.log(`\n\nFound ${this.workingProxies.length} working proxies. Saved to ${outputFile}`.green);
      process.exit();
      
    } catch (error) {
      console.error(`\nError processing proxy list: ${error.message}`.red);
    }
  }

  updateProgress() {
    const progress = ((this.completedChecks / this.totalChecks) * 100).toFixed(1);
    process.stdout.write(`\rProgress: ${progress}% (${this.completedChecks}/${this.totalChecks}) - Found ${this.workingProxies.length} working proxies`);
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
