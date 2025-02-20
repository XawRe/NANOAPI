const app = require('express')();
var Limiter = require('async-limiter');
var t = new Limiter({ concurrency: 1 });

const superagent = require('superagent');

RPC_SERVER='https://rainstorm.city/api';
WORK_SERVER='https://rainstorm.city/api';
REQUEST_TIMEOUT=60*1000;	// 10 seconds
WORK_LOCAL=true;			// If false, work is requested from Nano Node
DEFAULT_REPRESENTATIVE='nano_1center16ci77qw5w69ww8sy4i4bfmgfhr81ydzpurm91cauj11jn6y3uc5y'; //NanoCenter

const work = require('worker_threads');

function post(url, params) {

    return new Promise((resolve, reject) => {
           superagent
              .post(url)
              .send(params)
              .set('accept', 'json')
              .end((err, res) => {
                // Calling the end function will send the request
                    console.log(params.action);
                           if (res.status != 200) {
                               return reject(res.body);
                           }
                           return resolve(res.body);
              });

    });
}

function account_balance(address) {
    input = {
        action: 'account_balance',
        account: address
    }
    return post(RPC_SERVER, input);
}

const { megaToRaw, rawToMega } = require('nano-unit-converter');

app.use(require('express').json());

app.use((req, res, next) => {
    const key = req.header('Authorization');
    if (!key) return res.status(403).send('No key!');
    
    if (key != '18520223-6013-4b55-8ac5-5726fa531b7e') return res.status(403).send('Invalid key');
    
    next();
});

app.get('/balance', async (req, res) => {
    
    let balls = await account_balance('nano_1pbkbcoqz1piii773g6tuwoyy6gyy7m6yiyqqzokf7yac9d369xcay36gabc');
    let xno = rawToMega(balls.balance);
    let pending = balls.receivable > 0 ? rawToMega(balls.receivable) : 0;
    
    let level = 'unknown';
    
    if (xno >= 0.01) {
        level = 'fine';
    } else if (xno >= 0.00009) {
        level = 'still_fine';
    } else {
        level = 'dry';
    }
    
    res.json({
        balance: xno,
        pending,
        level
    });
})

app.post('/send', async (req, res) => {
    let { addr, amount } = req.body;
    if (!addr || !amount) {
        return res.send('No addr or amount in body');
    }
    amount = parseFloat(amount);
    if (isNaN(amount)) return res.send('Invalid int');
    
    if (amount > 0.0001) return res.send('Amount too high');
    
    res.send('Added to queue!');
    
    t.push(async (cb) => {
        
      const worker = new work.Worker(__dirname + '/work.js', {
        workerData: {
            addr,
            amount
        },
      });
      worker.on('exit', (code) => {
        cb();
      });
        
    });
    
});

app.listen(process.env.SERVER_PORT, () => {
    console.log('Online ', process.env.SERVER_PORT);
});
