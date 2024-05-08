const { exec } = require('child_process');

const REGION = process.argv.find(arg => arg.startsWith('--region')).split('=')[1];
const MIN_CPU = parseInt(process.argv.find(arg => arg.startsWith('--min-cpus')).split('=')[1]);
const MAX_CPU = parseInt(process.argv.find(arg => arg.startsWith('--max-cpus')).split('=')[1]);

let allInstances = [];

async function executeCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (err, stdout, stderr) => {
            if (err) {
                reject(err);
            } else {
                resolve(stdout);
            }
        });
    });
}

async function processInstances(cpu) {
    const stdout = await executeCommand(`az vm list-sizes --location ${REGION} --query 'sort_by([?numberOfCores == \`${cpu}\` && !contains(name, \`Promo\`) && !contains(name, \`Standard_B\`)], &memoryInMB) | [:9].{Name:name, NumberOfCores:numberOfCores, MemoryInMB:memoryInMB}' -o json`);
    
    const sizes = JSON.parse(stdout);

    if (sizes.length === 0) {
        return;
    }

    const url = 'https://prices.azure.com/api/retail/prices';
    const filterPart = sizes.map(size => `(armSkuName eq '${size.Name}')`).join(' or ');

    const pricesOutput = await executeCommand(`az rest --method get --url "${url}" --url-parameters \\$filter="serviceName eq 'Virtual Machines' and armRegionName eq '${REGION}' and contains(skuName, 'Spot') eq true and (${filterPart})" --query "sort_by(Items, &unitPrice)" -o json`);
    
    const prices = JSON.parse(pricesOutput);
    
    const instances = prices.map(({armSkuName, unitPrice, productName}) => {
        const size = sizes.find(s => s.Name === armSkuName);

        return {
            name: armSkuName,
            price: unitPrice,
            desc: productName,
            monthlyPrice: unitPrice * 720,
            cpu: size.NumberOfCores,
            mem: `${(size.MemoryInMB / 1024)} GB`
        };
    });

    allInstances = allInstances.concat(instances);
}

async function run() {
    for (let cpu = MIN_CPU; cpu <= MAX_CPU; cpu++) {
        await processInstances(cpu);
    }

    allInstances = allInstances.filter(instance => !instance.desc.includes('Windows'));
    allInstances.sort((a, b) => a.price - b.price);
    
    console.table(allInstances.map(instance => ({
        ...instance,
        price: `$${parseFloat(instance.price).toFixed(2)}`,
        monthlyPrice: `$${parseFloat(instance.monthlyPrice).toFixed(2)}`
    })), ['name', 'desc', 'cpu', 'mem', 'price', 'monthlyPrice']);
}

run();