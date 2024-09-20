const { Program, Command } = require('lovacli');

const path = require('path');
const HistoricalMarket = require('../classes/HistoricalMarket.js');

const Market = require('../classes/Market.js');
const ConsoleUI = require('../classes/ConsoleUI.js');

const MarketTrader = require('../classes/MarketTrader.js');

class Handler extends Command {
    setup(progCommand) {
        progCommand.description('Go to the current market and trade');
        progCommand.argument('[filename]', '.dat file path with historical prices');
        progCommand.argument('[strategyName]', 'strategyName');
        progCommand.argument('[symbol]', 'trading symbol pair name, like btcusd');
        progCommand.argument('[ui]', 'Disply UI progress 0/1, default 1', 1);
    }

    async handle(args, options, logger) {
        if (args.ui) {
            const rawLogger = logger;
            logger = {
                info: (...fArgs)=>{
                    if (ConsoleUI.isInitialized()) {
                        ConsoleUI.debug.apply(ConsoleUI, fArgs);
                    } else {
                        rawLogger.info.apply(rawLogger, fArgs);
                    }
                }
            };
        }

        let market = Market.getSingleton();
        market.setLogger(logger);

        const symbol = args.symbol;

        // try to find the setting corresponding to this symbol-strategyname
        const config = this.program.config;
        let traderSetting = {};
        for (let setting of config.traders) {
            if (setting.symbol == symbol && setting.strategyName == args.strategyName) {
                traderSetting = setting;
            }
        }

        const marketTrader = new MarketTrader({
            symbol: symbol,
            mode: 'market',
            strategyName: args.strategyName,
            logger: logger,
            traderSetting: traderSetting,
        });

        try {
            await marketTrader.prepareSymbolInfo(); // load symbol information from market (this api is public, no api keys needed)
            logger.info('Got symbol infromation from the market: '+args.symbol);
        } catch(e) {
            console.log(e);

            logger.error('Can not get symbol information from the market');
            this.program.exit(null);
        }

        logger.info('Restoring bids data from market...');
        await marketTrader.restoreDataFromMarket();

        const currentPath = process.cwd();
        const filename = path.join(currentPath, args.filename);

        logger.info('Loading .dat file with historical prices: '+filename);

        let timeStart = +new Date();

        const historicalMarket = new HistoricalMarket();
        await historicalMarket.readFromFile(filename);
        historicalMarket.disableCSV();

        let timeEnd = +new Date();
        logger.info('Loaded in '+(timeEnd - timeStart)+' ms');

        logger.info('Getting prices till now from real market... Run refreshdat over .dat file to make this step faster.');

        await historicalMarket.fulfilTillNow(symbol);

        logger.info('Filling prices gaps in last 2 weeks');

        await historicalMarket.fillGaps();

        logger.info('Filling older gaps if there re any');

        await historicalMarket.fillOlderGaps();

        logger.info('Checking integrity...');

        if (!historicalMarket.isIntegrityOk()) {
            throw new Error('Integrity is broken. Run refreshdat over .dat file');
        } else {
            logger.info('Integrity is ok');
        }

        if (args.ui) {
            await ConsoleUI.initialize();
        }

        let time = (new Date()).getTime();
        let price = null;
        let i = 0;
        do {
            const ticker = await market.getTicker(symbol);

            if (ticker) {
                await historicalMarket.pushLowestCombinedIntervalRAWAndRecalculateParents(ticker);
                time = ticker.time;


                price = await historicalMarket.getPriceAt(time);
                price = await price.getInterval(HistoricalMarket.INTERVALS.MIN5);

                if (price) {
                    try {
                        await marketTrader.processNewCombinedPrice(price);
                    } catch(e) {
                        console.error(e);
                    }
                }

                try {
                    if (args.ui) await ConsoleUI.drawMarketTrader(marketTrader);
                    if (!args.ui) logger.info('Current price: '+price.price);
                } catch(e) {
                    logger.info(e);
                    throw e;
                }
            }

            await new Promise((res)=>{ setTimeout(res, 10000); });
        } while(true);
    }
};

module.exports = Handler;