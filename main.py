import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry
import time

def create_session():
    session = requests.Session()
    retries = Retry(total=5, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retries)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

def fetch_proxies():
    base_url = "https://www.freeproxy.world/?type=&anonymity=4&country=&speed=1089&port=&page="
    proxies = []
    session = create_session()

    for page in range(1, 4):  # Fetch first 3 pages
        try:
            print(f"Fetching page {page}...")
            response = session.get(base_url + str(page), timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            table = soup.find("table", {"class": "layui-table"})
            if not table:
                print(f"No table found on page {page}.")
                continue
            rows = table.find_all("tr")[1:]
            for row in rows:
                columns = row.find_all("td")
                if len(columns) >= 2:
                    ip = columns[0].get_text(strip=True)
                    port = columns[1].get_text(strip=True)
                    prot = columns[5].get_text(strip=True)
                    proxies.append(f"{prot}://{ip}:{port}")
            time.sleep(3)  # Delay between requests
        except requests.exceptions.Timeout:
            print(f"Timeout occurred for page {page}. Skipping...")
        except requests.exceptions.RequestException as e:
            print(f"Error fetching page {page}: {e}")
    
    return proxies

def save_proxies(proxies, filename="proxies.txt"):
    with open(filename, "w") as file:
        for proxy in proxies:
            file.write(proxy + "\n")
    print(f"Saved {len(proxies)} proxies to {filename}")

if __name__ == "__main__":
    proxies = fetch_proxies()
    if proxies:
        save_proxies(proxies)
    else:
        print("No proxies found.")
