import * as operations from './spreadsheet/operations.js';
import { runScraper as scrape } from './scraper/scraper.js';
import { observeOperation } from './logging/logging.js';
function createMenu() {
  SpreadsheetApp.getUi()
    .createMenu('Job Tracker')
    .addItem('Set up tracker', 'setup')
    .addItem('Run now', 'runScraper')
    .addSeparator()
    .addItem('Enable hourly refresh', 'enableHourlyRefresh')
    .addItem('Disable hourly refresh', 'disableHourlyRefresh')
    .addToUi();
}

export function onOpen() {
  return observeOperation('onOpen', createMenu);
}
export function setup() {
  return observeOperation('setup', operations.setup);
}
export function runScraper() {
  return observeOperation('runScraper', scrape);
}
export function enableHourlyRefresh() {
  return observeOperation('enableHourlyRefresh', operations.enableHourlyRefresh);
}
export function disableHourlyRefresh() {
  return observeOperation('disableHourlyRefresh', operations.disableHourlyRefresh);
}

export function clearJobs() {
  return observeOperation('clearJobs', operations.clearJobs);
}
