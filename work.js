/* Depends on nanocurrency-js
 * github: https://github.com/marvinroger/nanocurrency-js
 * npm: https://www.npmjs.com/package/nanocurrency
 * jsdelivr: https://cdn.jsdelivr.net/npm/nanocurrency/dist/nanocurrency.umd.js
*/

// View other options of Public Nano Nodes: https://publicnodes.somenano.com
RPC_SERVER='https://rainstorm.city/api';
WORK_SERVER='https://rainstorm.city/api';
REQUEST_TIMEOUT=60*1000;	// 10 seconds
WORK_LOCAL=true;			// If false, work is requested from Nano Node
DEFAULT_REPRESENTATIVE='nano_1center16ci77qw5w69ww8sy4i4bfmgfhr81ydzpurm91cauj11jn6y3uc5y'; //NanoCenter

const superagent = require('superagent');
const NanoCurrency = require('nanocurrency');

// const superagent = require('superagent');
// const { megaToRaw, rawToMega } = require('nano-unit-converter');

let proc = process;

function string_add(n1, n2, pad=0) {
    return (BigInt(n1) + BigInt(n2)).toString().padStart(pad, '0');
}

function string_sub(n1, n2, pad=0) {
    return (BigInt(n1) - BigInt(n2)).toString().padStart(pad, '0');
}

// Send a POST request and return a Promise
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

function block_info(hash) {
    input = {
        action: 'block_info',
        json_block: true,
        hash: hash
    }
    return post(RPC_SERVER, input);
}

function receivable(address, count=undefined, threshold=undefined) {
    input = {
        action: 'receivable',
        account: address,
        count: count,
        threshold: threshold
    }
    return post(RPC_SERVER, input);
}

function account_info(address, representative=true) {
    input = {
        action: 'account_info',
        representative: representative,
        account: address
    }
    return post(RPC_SERVER, input);
}

function active_difficulty() {
    input = {
        action: 'active_difficulty'
    }
    return post(RPC_SERVER, input);
}

function work_generate(hash, difficulty=undefined, multiplier=undefined) {
    input = {
        action: 'work_generate',
        hash: hash,
        difficulty: difficulty,
        multiplier: multiplier
    }
    return post(WORK_SERVER, input);
}

function _process(block, subtype) {
    input = {
        action: 'process',
        json_block: true,
        subtype: subtype,
        block: block
    }
    return post(RPC_SERVER, input);
}

function create_nano_account(seed, index) {
    const secretKey = NanoCurrency.deriveSecretKey(seed, index);
    const publicKey = NanoCurrency.derivePublicKey(secretKey);
    const address = NanoCurrency.deriveAddress(publicKey).replace('xrb_', 'nano_');

    return {
        secret: secretKey,
        public: publicKey,
        address: address
    }
}

// Returns "work" value; will check global WORK_LOCAL to determine if work
// is to be computed locally or if it is to be outsourced to the Nano Node
function work_helper(hash, subtype, verbose=true) {
    return new Promise(async (resolve, reject) => {
        let response = await active_difficulty();
        let work_threshold = response.network_current;
        if (subtype == 'receive') {
            work_threshold = response.network_receive_current;
        }

        if (verbose) console.log('Computing work for subtype '+ subtype +', difficulty: '+ work_threshold +' (work being done locally: '+ WORK_LOCAL +')', hash);
        let work = undefined;
        if (WORK_LOCAL) {
            var wStart = Math.floor(Date.now()/1000);
            work = await NanoCurrency.computeWork(hash, {workThreshold: work_threshold});
            var wEnd = Math.floor(Date.now()/1000);
            console.log(`Work took ${wEnd-wStart} seconds! ( ${(wEnd-wStart)/60} minutes )`);
        } else {
            work = (await work_generate(hash, work_threshold)).work;
        }

        resolve(work);
    });
}

function receive_block(address, public, secret, hash) {
    return new Promise(async (resolve, reject) => {
        console.log('Receiving in address '+ address +' from block '+ hash);
        let link = hash;
        let info = {
            block: (await block_info(link)),
            account: (await account_info(address))
        }

        let subtype = 'receive';
        let representative = info.account.representative;
        let previous = info.account.frontier;
        let old_balance = info.account.balance;
        let work_input = info.account.frontier;
        
        // If this is the first block in the account (Open), it has some specific requirements
        if (old_balance === undefined) {
            // Receive (Open) Block
            // https://docs.nano.org/integration-guides/key-management/#first-receive-transaction
            // https://docs.nano.org/integration-guides/work-generation/#work-calculation-details
            old_balance = '0';
            previous = '0'.padStart(64, '0');
            representative = DEFAULT_REPRESENTATIVE;
            work_input = public;
        }
        
        // Request work be computed
        let work = await work_helper(work_input, subtype, true);
        
        // Calculate the new balance of the account
        let new_balance = string_add(old_balance, info.block.amount);
        
        // Create receive block
        let block = NanoCurrency.createBlock(secret, {
            work: work,
            previous: previous,
            representative: representative,
            balance: new_balance,
            link: link,
        });

        console.log('Processing block with block:');
        console.log(block);
        response = await _process(block.block, subtype);
        resolve(response);
        return;
    });
}

async function receive_all_receivable(address, public, secret) {
    // First request the hashes of all receivable Nano Blocks
    let response = await receivable(address);
    let blocks_receivable = response.blocks;

    // Iterate over receivable blocks and receive one at a time
    console.log('Found '+ blocks_receivable.length +' blocks receivable...');
    for (let link of blocks_receivable) {
        let response = await receive_block(address, public, secret, link);
        if (response.hash !== undefined) console.log('Published receive block: '+ response.hash);
        else console.error(response);
    }
}

function change(address, representative, secret) {
    return new Promise(async (resolve, reject) => {
        console.log('Changing representative of '+ address +' to '+ representative);
        let info = {
            account: await account_info(address)
        }

        let subtype = 'change';
        let link = '0'.padStart(64, '0');
        let previous = info.account.frontier;
        let balance = info.account.balance;
        let work_input = info.account.frontier;
        let work = await work_helper(work_input, subtype, true);
        
        // Create send block
        let block = NanoCurrency.createBlock(secret, {
            work: work,
            previous: previous,
            representative: representative,
            balance: balance,
            link: link,
        });

        console.log('Processing block with block:');
        console.log(block);
        response = await _process(block.block, subtype);
        resolve(response);
        return;
    });
}

function send(source, destination, secret, value_as_nano) {
    return new Promise(async (resolve, reject) => {
        console.log('Sending '+ value_as_nano +' Nano from address '+ source +' to '+ destination);
        let info = {
            account: await account_info(source)
        }

        let subtype = 'send';
        let link = destination;
        let representative = info.account.representative;
        let previous = info.account.frontier;
        let old_balance = info.account.balance;
        let work_input = info.account.frontier;
        let work = await work_helper(work_input, subtype, true);
        let value_as_raw = NanoCurrency.convert(String(value_as_nano), {
            from: 'Nano',
            to: 'raw',
        });
        let new_balance = string_sub(old_balance, value_as_raw);
        
        // Create send block
        let block = NanoCurrency.createBlock(secret, {
            work: work,
            previous: previous,
            representative: representative,
            balance: new_balance,
            link: link,
        });

        console.log('Processing block with block:');
        console.log(block);
        response = await _process(block.block, subtype);
        resolve(response);
        return;
    });
}

async function go() {
    // send(account.address, 'nano_3oqnx3t8ui5tj5uag8wi4rupgyrfp7gjq3a1oisronsetubzaad6sf5zk3pz', account.secret, 0.00001);
}


const {
  workerData
} = require('worker_threads');

async function main() {
    const seed = '64599B1C7229368E91C1F091C3749A3738FB77A2B7EA888447D16920C571C067';
    
    const account = create_nano_account(seed, 0);
    
    await send(account.address, workerData.addr, account.secret, parseFloat(workerData.amount));
    
}

main();