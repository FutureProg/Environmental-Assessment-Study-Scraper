import { JSDOM } from 'jsdom';

async function main() {
  const dom = await JSDOM.fromURL('https://www.halton.ca/for-residents/infrastructure-and-growth/municipal-class-environmental-assessment-studies?searchtext=&searchmode=anyword&sort=8&page=1#hal-search-results-environmentalassessments', {    
    includeNodeLocations: true,
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  console.log(document.readyState);
  const rows = document.querySelectorAll('.hal-generic-smart-search-results-table tbody tr');
  
}

await main();