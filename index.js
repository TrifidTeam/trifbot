const { RTMClient } = require('@slack/client'); //slack client
const { Client } = require('pg') //postgresql
require('dotenv').config(); // load .env file
var request = require('request');
var nebliojs = require('bitcoinjs-lib'); // this is actually nebliojs-lib "https://github.com/NeblioTeam/bitcoinjs-lib.git#nebliojs-lib"

var backup_folder = '/backups/'

if (process.env.BOT_NETWORK_NEBL == 'MAINNET'){
	var NTP1_API_URL = 'https://ntp1node.nebl.io/ntp1/'
	var NEBLIO_EXPLORER_URL = 'http://explorer.nebl.io/'
} else {
	var NTP1_API_URL = 'https://ntp1node.nebl.io/testnet/ntp1/'
	var NEBLIO_EXPLORER_URL = 'http://explorer.neblio.tokento.me/'
}

//returns the address params from sql
function getAddressParams(userid) {
	return new Promise(function(resolve, reject) {
		if (userid.length==34) {resolve({'address':userid, 'pvtkey':'xxx'})	
		} else {
			tempquery = 'SELECT userid, address, pvtkey FROM users WHERE userid = ' + userid + ';';
			client.query(tempquery, (err, res) => {
				if (err) {
					console.log(err.stack)
					reject(err);
				} else {
					console.log('Address exists!')
					console.log(res.rows[0])
					resolve(res.rows[0])
				}
			})
		}
	})
}

//backup table to a csv file next address with NULL userid
function backupAddresses() {
	return new Promise(function(resolve, reject) {
		time = Date.now();
		tempquery = "Copy (SELECT * From users ORDER BY index ASC) To '" + backup_folder + "backup_" + String(Date.now()) + ".csv' With CSV DELIMITER ',';"
		client.query(tempquery, (err, res) => {
			if (err) {
				console.log(err.stack);
				reject(err);
			} else {
				console.log('Addresses backed up!');
				resolve('backed_up');
			}
		})
	})
}

//returns next address with NULL userid
function findNextUnassignedAddress() {
	return new Promise(function(resolve, reject) {
		tempquery = 'SELECT index, address FROM users WHERE userid IS NULL ORDER BY index ASC LIMIT 1;';
		client.query(tempquery, (err, res) => {
			if (err) {
				console.log(err.stack);
				reject(err);
			} else if (res.rowCount == 0) {
				console.log('Ack! All addresses are assigned!');
				reject(err);
			} else {
				console.log('Got next address: ' + res.rows[0]['address']);
				resolve(res.rows[0]['index']);
			}
		})
	})
}

//assigns address at specific index to specific userid
function assignAddress(userid, index) {
	return new Promise(function(resolve, reject) {
		tempquery = 'UPDATE users SET userid = '+ userid + ' WHERE index = '+index + ';';
		client.query(tempquery, (err, res) => {
			if (err) {
				console.log(err.stack);
				reject(err);
			} else if (res.rowCount == 0) {
				console.log('Ack! All addresses are assigned!');
				reject(err);
			} else {
				console.log('Address has been assigned for ' + userid);
				resolve(res);
			}
		})
	})
}

//return details from specific userid, and assign them a new address if they don't have one
function checkAddress(userid) {
	return new Promise(function(resolve, reject) {
		tempquery = 'SELECT userid, address, pvtkey FROM users WHERE userid = ' + userid + ';';
		client.query(tempquery, (err, res) => {
			if (err) {
				console.log(err.stack)
			} else if (res.rowCount == 0) {
				console.log('No address found, assigning new address')
				findAddressPromise = findNextUnassignedAddress();
				findAddressPromise.then(
					function(index) {
						var assignPromise = assignAddress(userid, index)
					}, function(err) {
						console.log(err);
					}).then(
					function(index) {
						var getAddressPromise = getAddressParams(userid)
						resolve(getAddressPromise);
					}, function(err) {
						console.log(err)
						reject(err);
					})
				} else {
					console.log('Address exists!')
					console.log(res.rows[0])
					resolve(res.rows[0]);
				}
			})
	})
}

//gets user list from slack
function getUserList(tok) {
	return new Promise(function(resolve, reject) {
		request.get('https://slack.com/api/users.list?token='+tok,
			function (error, response, body) {
				if (error) {
					reject(error);
				} else {
                    //console.log(body);
                    resolve(JSON.parse(body));
                }
            });
	});
};

//gets user list from slack
async function validateUser(user) {
	return new Promise(function(resolve, reject) {
		if (user.deleted == false){
			userid = "'"+user.id+"'";
			//console.log(userid)
			checkAddressPromise = checkAddress(userid);
			checkAddressPromise.then(
				function(index) {
					console.log('Adding ' + user.id + ' to valid users list.')
					validUserNames.push(user.id);
					resolve('Success')
				}, function(err) {
					console.log(err);
					reject(err)
				})
		} else {
			resolve('That was a deleted user');
		}
	});
};

async function initialUserValidation(members){
	for (const user of members) {
		//console.log('USER***', user)
		await validateUser(user);
	}
	console.log('All Users Validated!')
}

function isNumber(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

function postToApi(api_endpoint, json_data) {
	return new Promise(function(resolve, reject) {
		console.log(api_endpoint+': ', JSON.stringify(json_data));
		request.post({
			url: NTP1_API_URL+api_endpoint,
			headers: {'Content-Type': 'application/json'},
			form: json_data
		},
		function (error, response, body) {
			if (error) {
				reject(error);
			} else {
				console.log('API Return: ', body);
				if (body.includes('504 Gateway Time-out')) {
					reject('504 Gateway Time-out')
				} else {
					resolve(JSON.parse(body));
				}
			}
		});
	});
};

function signTx (unsignedTx, wif0, wif1) {
	var privateKey0 = nebliojs.ECKey.fromWIF(wif0);
	var privateKey1 = nebliojs.ECKey.fromWIF(wif1);
	var tx = nebliojs.Transaction.fromHex(unsignedTx);

    var insLength = tx.ins.length;
    //sign the NEBL UTXO, it is the last input
    tx.sign((insLength-1), privateKey0);

    //sign for each of the NTP1 UTXOs, they are the first x inputs before the last
    for (var i = 0; i < (insLength-1); i++) {
    	tx.sign(i, privateKey1);
    }
    return tx.toHex();
}

function getNTP1UTXOs(address){
	return new Promise(function(resolve, reject) {
		var ntp1_from_address = '';
		var ntp1_from_address_balance = 0;
		var ntp1_from_holdings = getHoldings(address)
		ntp1_from_holdings.then(
			function(holdings) {
				return holdings.utxos;
			}, function(err) {
				console.log(err);
				reject(err)
			}).then(
			function(utxos) {
				var tokenholdings = [];
				var tok = '';
				for (var i = 0; i < utxos.length; i++) {
					if(utxos[i].tokens.length > 0 && utxos[i].used == false) {
						for (var j = 0; j < utxos[i].tokens.length; j++) {
							var thisEntry = {'txid':utxos[i].txid,'index':utxos[i].index,'tokenId':utxos[i].tokens[j].tokenId,'amount':utxos[i].tokens[j].amount}
							tokenholdings.push(thisEntry);	
						}
					}
				}
				resolve(tokenholdings);
			},function(err){
				console.log(err);
				reject(err);
			})
	});
};

function getNEBLUTXOs(address){
	return new Promise(function(resolve, reject) {
		var ntp1_from_address = '';
		var ntp1_from_address_balance = 0;
		var ntp1_from_holdings = getHoldings(address)
		ntp1_from_holdings.then(
			function(holdings) {
				return holdings.utxos;
			}, function(err) {
				console.log(err);
				reject(err)
			}).then(
			function(utxos) {
				var neblholdings = [];
				for (var i = 0; i < utxos.length; i++) {
					if(utxos[i].tokens.length == 0 && utxos[i].used == false && utxos[i].value >= 20000 ) {
						var thisEntry = {'txid':utxos[i].txid,'index':utxos[i].index,'value':utxos[i].value}
						neblholdings.push(thisEntry);	
					}
				}
				resolve(neblholdings);
			},function(err){
				console.log(err);
				reject(err);
			})
	});
};

function findNeblUTXO(utxos, tokenid, amount){
	return new Promise(function(resolve, reject) {
		for (var i = 0; i < utxos.length; i++) {
			if (utxos[i].tokenId == tokenid && utxos[i].amount >= 0.0003) {
				resolve(utxos[i])
			}
		}
		resolve('Found NEBL UTXO on main address')
	});
}

function calculateTokenHoldings(utxos){
	return new Promise(function(resolve, reject) {
		var tokenholdings = {};
		var tok = '';
		for (var i = 0; i < utxos.length; i++) {
			tok = utxos[i].tokenId;
			if (tokenholdings.hasOwnProperty(tok)) {
				tokenholdings[tok] = tokenholdings[tok] + utxos[i].amount;
			} else {
				tokenholdings[tok] = utxos[i].amount;
			}
		}
		resolve(tokenholdings);
	})
};

//*******************************************************************
function getNTP1Holdings(addy) {
	return new Promise(function(resolve, reject) {
		console.log('Getting NTP1 Holdings of: ', addy);
		request.get(NTP1_API_URL+'addressinfo/'+addy,
			function (error, response, body) {
				if (error) {
					reject(error);
				} else {
                    //console.log(body);
                    resolve(JSON.parse(body));
                }
            });
	});
};

function calculateNTP1Holdings(userid){
	return new Promise(function(resolve, reject) {
		var ntp1_from_address = '';
		var ntp1_from_address_balance = 0;
		var getFromDetails = getAddressParams(userid);
		getFromDetails.then(
			function(from_details){
				var ntp1_from_holdings = getNTP1Holdings(from_details.address)
				ntp1_from_holdings.then(
					function(holdings) {
					return holdings.utxos; //return the utxos the address is holding
				}, function(err) {
					console.log(err);
					reject(err)
				}).then(
				function(utxos) {
					var tokenholdings = {};
					var tok = '';
			        //console.log('utxos: ', utxos)
			        //loop through the utxos and create a summary object of {tokenid:balance} to sum up each token balance across the UTXOs
			        var arrayLength = utxos.length
			        for (var i = 0; i < arrayLength; i++) {
			            //console.log('tokens: ', i, ": ", utxos[i].tokens);
			            if(utxos[i].tokens.length > 0) {
				            tok = utxos[i].tokens[0].tokenId;
				            if (tokenholdings.hasOwnProperty(tok)) {
				            	tokenholdings[tok] = tokenholdings[tok] + utxos[i].tokens[0].amount;
				            } else {
				            	tokenholdings[tok] = utxos[i].tokens[0].amount;
				            }
				        }
			        }
			        //console.log('tokenholdings: ' + tokenholdings[token_id])
			        //if (tokenholdings.length > 0){
			        	console.log('NTP1 Token holdings for this address: ', tokenholdings);
			        	var hodl = {"address":from_details.address, "tokenholdings":[tokenholdings]};
			        	resolve(hodl);
			        //} else {
			        //	console.log('No NTP1 Tokens Found')
			        //	var hodl = {"address":from_details.address, "tokenholdings":['']};
			        //	resolve(hodl);
			        //}
			    },function(err){
			    	console.log(err);
			    	reject(err);
			    })
			})
	});
};

//*******************************************************************

function findPerfectUTXO(utxos, tokenid, amount){
	return new Promise(function(resolve, reject) {
		for (var i = 0; i < utxos.length; i++) {
			if (utxos[i].tokenId == tokenid && utxos[i].amount == amount) {
				resolve(utxos[i])
			}
		}
		resolve('Could Not Find Perfect UTXO')
	});
}

function sortUTXOs(a,b) {
  if (a.amount < b.amount)
    return -1;
  if (a.amount > b.amount)
    return 1;
  return 0;
}

async function getUTXOGroup(utxos, tokenid, amount){
	return new Promise(function(resolve, reject) {
	var utxos_to_send = [];
	var keepgoing = true;
	var totalsofar = 0;
	var i = 0;
	var result = '';
	var change = 0;

	while(keepgoing){
		if (totalsofar == amount) {
			result = 'found perfect group';
			console.log('result: ',result)
			keepgoing = false;
		} else if (i >= 15) { //I+1 (NEBL input) IS NUMBER OF INPUTS
			result = 'too many utxos';
			console.log('result: ',result)
			change = totalsofar;
			keepgoing = false;
		} else if (totalsofar > amount) {
			result = 'found group will need change';
			console.log('result: ',result)
			change = totalsofar - amount;
			keepgoing = false;
		} else if (utxos[i].tokenId == tokenid) {
			utxos_to_send.push(utxos[i]);
			totalsofar = totalsofar + utxos[i].amount
			console.log(totalsofar)
		}
		i++
	}
	resolve({'result':result, 'utxos':utxos_to_send,'change':change})
})};

function getHoldings(addy) {
	return new Promise(function(resolve, reject) {
		console.log('Getting NTP1 Holdings of: ', addy);
		request.get(NTP1_API_URL+'addressinfo/'+addy,
			function (error, response, body) {
				if (error) {
					reject(error);
				} else {
                    //console.log(body);
                    resolve(JSON.parse(body));
                }
            });
	});
};


function sendNTP1Transaction(shouldsend, sendutxo, sendto, nebl_privkey, ntp1_from_privkey){
	if (shouldsend == true){
		var inputs = sendutxo.length;
		var outputs = sendto.length;
		var fee = Math.ceil((inputs*180+outputs*34+10+inputs) / 1024)*10000


		send_token = {
			"fee": fee,
			"sendutxo": sendutxo,
			"to": sendto
		};
		console.log('send_token:', send_token)
		var sendPromise = postToApi("sendtoken", send_token);
		sendPromise.then(
			function(result) {
				var body = result;
				console.log('Raw: '+body.txHex);
				console.log('NEBL:', nebl_privkey);
				console.log('NTP1:', ntp1_from_privkey);
				var signed = signTx(body.txHex, nebl_privkey, ntp1_from_privkey);
				var transaction = {"txHex": signed};
				var broadcastPromise = postToApi("broadcast", transaction);
				broadcastPromise.then(
					function(bcast){
						var hl = 'Sent! Link to txn: \r'+NEBLIO_EXPLORER_URL+'tx/' + bcast.txid;
						rtm.sendMessage(hl, conversationId);
						return bcast;
					}, function(err){
						console.log(err)
						rtm.sendMessage('API Error -- check your parameters and try again', conversationId);
						return false;
					})
			}, function(err) {
				console.log(err);
				rtm.sendMessage('API Error -- check your parameters and try again', conversationId);
			}
			)
	}
}

function determineTransactionType(perfectNTP1UTXO, utxos, token_id, ntp1_send_amount_request, NEBLutxos, ntp1_to_address, ntp1_from_address){
	return new Promise(function(resolve, reject) {
		var shouldsend = false;
		var sendutxo = [];
		var sendto = [];
		console.log('perfectNTP1UTXO: ',perfectNTP1UTXO)
		if (typeof perfectNTP1UTXO === 'string'){
			console.log('You do not have a perfect UTXO, finding a group of them...')
			utxos = utxos.sort(sortUTXOs)
			var getUTXOgroupPromise = getUTXOGroup(utxos, token_id, ntp1_send_amount_request)
			getUTXOgroupPromise.then(
				function(res){
					var result = res.result;
					var UTXOgroup = res.utxos;
					var change = res.change;
					switch(result) {
						case 'found perfect group': //call tip with no change
							sendutxo.push(NEBLutxos[0].txid + ':' + NEBLutxos[0].index)
							for (var i = 0; i < UTXOgroup.length; i++) {
								sendutxo.push(UTXOgroup[i].txid + ':' + UTXOgroup[i].index);
							}
							sendto.push({ //send requested amount to the to_address
								"address": ntp1_to_address,
								"amount": ntp1_send_amount_request,
								"tokenId": token_id
							})
							shouldsend = true;
							resolve({'shouldsend':shouldsend, 'sendutxo':sendutxo, 'sendto':sendto});
							break;

						case 'found group will need change': //call tip with change
							console.log('found a group, but you will get change back')
							sendutxo.push(NEBLutxos[0].txid + ':' + NEBLutxos[0].index)
							for (var i = 0; i < UTXOgroup.length; i++) {
								sendutxo.push(UTXOgroup[i].txid + ':' + UTXOgroup[i].index);
							}
							sendto.push({ //send requested amount to the to_address
								"address": ntp1_to_address,
								"amount": ntp1_send_amount_request,
								"tokenId": token_id
							})
							sendto.push({ //send balance back to the sender
								"address": ntp1_from_address,
								"amount": change,
								"tokenId": token_id
							})
							shouldsend = true;
							resolve({'shouldsend':shouldsend, 'sendutxo':sendutxo, 'sendto':sendto});
							break;

						case 'too many utxos': //call consolidate UTXOs
							var msg = 'we need to consolidate your UTXOs! try that tip again in minute or so';
							console.log(msg)
							rtm.sendMessage(msg, conversationId);

							sendutxo.push(NEBLutxos[0].txid + ':' + NEBLutxos[0].index)
							for (var i = 0; i < UTXOgroup.length; i++) {
								sendutxo.push(UTXOgroup[i].txid + ':' + UTXOgroup[i].index);
							}
							sendto.push({ //send balance back to the sender
								"address": ntp1_from_address,
								"amount": change, // here change is actually just total tokens in the max # inputs
								"tokenId": token_id
							})

							shouldsend = true;
							resolve({'shouldsend':shouldsend, 'sendutxo':sendutxo, 'sendto':sendto});
							break;

						default:
							var msg = ''
						}
					})
		} else {
			console.log('You had a perfect UTXO: ', perfectNTP1UTXO)
			sendutxo.push(NEBLutxos[0].txid + ':' + NEBLutxos[0].index)
			sendutxo.push(perfectNTP1UTXO.txid + ':' + perfectNTP1UTXO.index);
			sendto.push({ //send balance back to the sender
				"address": ntp1_to_address,
				"amount": ntp1_send_amount_request, // here change is actually just total tokens in the max # inputs
				"tokenId": token_id
			})
			shouldsend = true;
			resolve({'shouldsend':shouldsend, 'sendutxo':sendutxo, 'sendto':sendto});
		}
	})
};

//**************VALIDATE BASE58 ADDRESS DOES NOT WORK YET******************
function validateBase58address (addr) {
  try {
    nebliojs.address.toOutputScript(addr)
    return true
  } catch (e) {
    return false
  }
}

function tokenIDLookup(tokencode){
	if(tokencode == 'trif' || tokencode == 'trifid'){
		return 'La3QxvUgFwKz2jjQR2HSrwaKcRgotf4tGVkMJx'; // Testnet TRYF = 'La3jvfiaXpB71mXAzKgJkhAxLSDVTDv7k56Mv4'
	} else if (tokencode == 'ndex' || tokencode == 'neblidex') {
		return 'LaAHPkQRtb9AFKkACMhEPR58STgCirv7RheEfk';  // Testnet NDOX = 'La6QgNbyhSa7PcPkdoVag8qoKveZyqnAAVcg7D'
	} else if (tokencode == 'qrt' || tokencode == 'qredit') {
		return 'La59cwCF5aF2HCMvqXok7Htn6fBE2kQnA96rrj';  // qredit = 'La59cwCF5aF2HCMvqXok7Htn6fBE2kQnA96rrj'
	} else if (tokencode == 'ptn' || tokencode == 'potionowl') {
		return 'La5NtFaP8EB6ozdqXWdWvzxuZuk3Q3VLic8sQJ';  // potionowl = 'La5NtFaP8EB6ozdqXWdWvzxuZuk3Q3VLic8sQJ'
	} else {
		var msg = 'Invalid token code, we only accept TRIF, NDEX, PTN, and QRT right now';
		console.log(msg)
		rtm.sendMessage(msg, conversationId);
		return msg;
	}
}

function tokenCodeLookup(tokenid){
	if(tokenid == 'La3QxvUgFwKz2jjQR2HSrwaKcRgotf4tGVkMJx'){
		return 'TRIF'; // Testnet TRYF = 'La3jvfiaXpB71mXAzKgJkhAxLSDVTDv7k56Mv4'
	} else if (tokenid == 'LaAHPkQRtb9AFKkACMhEPR58STgCirv7RheEfk') {
		return 'NDEX'; // Testnet NDOX = 'La6QgNbyhSa7PcPkdoVag8qoKveZyqnAAVcg7D'
	} else if (tokenid == 'La59cwCF5aF2HCMvqXok7Htn6fBE2kQnA96rrj') {
		return 'QRT'; // qredit = 'La59cwCF5aF2HCMvqXok7Htn6fBE2kQnA96rrj'
	} else if (tokenid == 'La5NtFaP8EB6ozdqXWdWvzxuZuk3Q3VLic8sQJ') {
		return 'PTN'; // potionowl = 'La5NtFaP8EB6ozdqXWdWvzxuZuk3Q3VLic8sQJ'
	} else {
		return tokenid;
	}
}

function getSupply(tokenid) {
	return new Promise(function(resolve, reject) {
		console.log('Getting all holders of: ', tokenid);
		request.get(NTP1_API_URL+'stakeholders/'+tokenid,
			function (error, response, body) {
				if (error) {
					reject(error);
				} else {
					//console.log('API Return: ', body);
					if (body.includes('holders')) {
						resolve(JSON.parse(body));
					} else {
						console.log('API Return: ', body);
						reject('Did not return any holders')
					}
                }
            });
	});
};

function withdraw(inputs){

	var nebl_userid = inputs.nebl_userid;
	var ntp1_from_userid = inputs.ntp1_from_userid;
	var ntp1_to_userid = inputs.ntp1_to_userid;
	var token_id = inputs.token_id;
	var ntp1_send_amount_request = inputs.ntp1_send_amount_request;
	var ntp1_to_address = inputs.ntp1_to_address;

	if (ntp1_to_address.length==34) {
		var getNTP1ToDetailsPromise = getAddressParams(ntp1_to_address) //if an address was passed, this is a withdraw
	} else {
		var getNTP1ToDetailsPromise = getAddressParams(ntp1_to_userid)  //if a username was passed, this is a tip
	}	

	getNTP1ToDetailsPromise.then(
		function(NTP1toDetails){
			var getNEBLFromDetailsPromise = getAddressParams(nebl_userid)
			getNEBLFromDetailsPromise.then(
				function(NEBLfromDetails){
					var NEBLutxosPromise = getNEBLUTXOs(NEBLfromDetails.address)
					NEBLutxosPromise.then(
						function(NEBLutxos){
							if (NEBLutxos.length>=1) {
								console.log(NEBLutxos)
								var getNTP1FromDetailsPromise = getAddressParams(ntp1_from_userid);
								getNTP1FromDetailsPromise.then(
									function(NTP1fromDetails){
										if (NTP1fromDetails.address != NTP1toDetails.address) {
											var NTP1utxosPromise = getNTP1UTXOs(NTP1fromDetails.address)
											NTP1utxosPromise.then(
												function(utxos){
													var NTP1holdingsPromise = calculateTokenHoldings(utxos)
													NTP1holdingsPromise.then(
														function(NTP1holdings){
															if(NTP1holdings[token_id] >= ntp1_send_amount_request) {
																//var msg = 'You have enough! Requested ' + String(ntp1_send_amount_request) + ' and have ' + String(NTP1holdings[token_id]);
																//console.log(msg)
																//rtm.sendMessage(msg, conversationId);
																var perfectNTP1UTXOPromise = findPerfectUTXO(utxos, token_id, ntp1_send_amount_request)
																perfectNTP1UTXOPromise.then(
																	function(perfectNTP1UTXO){
																		var sendtokenPromise = determineTransactionType(perfectNTP1UTXO, utxos, token_id, ntp1_send_amount_request, NEBLutxos, NTP1toDetails.address, NTP1fromDetails.address)
																		sendtokenPromise.then(
																			function(sendToken){
																				var send = sendNTP1Transaction(sendToken.shouldsend, sendToken.sendutxo, sendToken.sendto, NEBLfromDetails.pvtkey, NTP1fromDetails.pvtkey)
																			})
																	}
																	)
															} else if (NTP1holdings.hasOwnProperty(token_id)) {
																var msg = 'Sorry, you do not have enough! Requested ' + ntp1_send_amount_request +' and have '+ NTP1holdings[token_id];
																console.log(msg)
																rtm.sendMessage(msg, conversationId);
															} else {
																var msg = 'Sorry, no tokens found.';
																console.log(msg)
																rtm.sendMessage(msg, conversationId);
															}
														})
												},function(err){
													console.log(err)
												})
										} else {
											var msg = 'Cannot withdraw to your own trifbot address'
											rtm.sendMessage(msg, conversationId);
										}
									})
							} else {
								var msg = 'No available NEBL UTXOs at the main address... Either send some NEBL to ' + NEBLfromDetails.address + ' or contact admin.'
								console.log(msg);
								rtm.sendMessage(msg, conversationId);
							}
						})
				})
		},function(err){
			console.log(err);
			rtm.sendMessage(err, conversationId);
		})
}

const timeout = ms => new Promise(res => setTimeout(res, ms))

async function twoSecondDelay () {
  await timeout(2000);
}

function withdrawAllTokens(userid, toAddress){
	var holdings = calculateNTP1Holdings("'"+userid+"'")
	holdings.then(
		async function(hold) {	
			var token_ids = Object.keys(hold['tokenholdings'][0])
			for (const tokid of token_ids) {
				var msg = 'Withdrawing ' + tokid;
				rtm.sendMessage(msg, conversationId);
				var main_nebl_user = 'MAIN';
				var inputs = {
					nebl_userid: "'"+main_nebl_user+"'",
					ntp1_from_userid: "'"+userid+"'",
					ntp1_to_userid: '',
					ntp1_to_address: toAddress,
					token_id: tokid,
					ntp1_send_amount_request: parseInt(hold['tokenholdings'][0][tokid])
				};
				withdraw(inputs);
				await twoSecondDelay();
			}
		},function(err) {
			console.log(err);
		})
}

//----------------------------START OF ACTUAL PROGRAM-----------------------------------

var validUserNames = [];
const slack_bot_token = process.env.SLACK_BOT_TOKEN_NEBL;

const client = new Client({
	user: process.env.DB_USER_NEBL,
	host: process.env.DB_HOST_NEBL,
	database: process.env.DB_DATABASE_NEBL,
	password: process.env.DB_PASSWORD_NEBL,
	port: process.env.DB_PORT_NEBL,
})

client.connect()

var userlistPromise = getUserList(slack_bot_token)
userlistPromise.then(
	function(ul) {
		//console.log('User List: ', ul.members)
		initialUserValidation(ul.members)
	}, function(err) {
		console.log(err);
	})

// The client is initialized and then started to get an active connection to the platform
const rtm = new RTMClient(slack_bot_token);
rtm.start();
var timerPrevious = Date.now();
console.log(timerPrevious);
var timerCurrent = Date.now();
console.log(timerCurrent);

var minTime = 2000;

backupAddresses();

// This argument can be a channel ID, a DM ID, a MPDM ID, or a group ID
var conversationId = 'C9TNSHPCZ';

// Log all incoming messages
rtm.on('message', (event) => {
	var tooFast = false;
	var msg = '';
	var type = 'invalid';
	conversationId = event.channel;
	timerCurrent = Date.now();
	console.log('Time Diff: ' + String(timerCurrent - timerPrevious));
	
	// Structure of `event`: <https://api.slack.com/events/message>
	console.log(`Message from ${event.user}: ${event.text}`);
	// parse the string
	if (event.hasOwnProperty('text')) {
		ask = event.text.trim().split(" ")

		if (ask.length <= 1) {
			type = 'do nothing';
		} else if ((timerCurrent - timerPrevious >= minTime) && ask.length == 5 && ask[0].toLowerCase() == 'trifbot' && ask[1].toLowerCase() == 'tip' && isNumber(ask[3])){
			var tip_to = ask[2].substring(2, 11).toUpperCase();
			console.log('Name: ' + tip_to + ' vs. ' + event.user)
			if(event.user==tip_to){
				type = 'selftip';
			} else if (parseInt(ask[3]) < 1 || !Number.isInteger(Number(ask[3]))) {
				type = 'badnum';
			} else if (tokenIDLookup(ask[4].toLowerCase()).length != 38){
				type = 'badtokencode';
			} else if (validUserNames.includes(tip_to)) {
				type = 'tip';
				timerPrevious = timerCurrent; //reset timer
			} else {
				type = 'usernotfound';
			}
		} else if (ask.length > 2 && ask[0].toLowerCase() == 'trifbot' && ask[1].toLowerCase() == 'tip') {
			type = 'badtipformat';
		} else if (ask.length == 2 && ask[0].toLowerCase() == 'trifbot' && ask[1].toLowerCase() == 'help') {
			type = 'help';
		} else if ((timerCurrent - timerPrevious >= minTime)  && ask.length == 2 && ask[0].toLowerCase() == 'trifbot' && ask[1].toLowerCase() == 'balance') {
			type = 'balance';
		} else if ((timerCurrent - timerPrevious >= minTime)  && (ask.length == 4) && (ask[0].toLowerCase() == 'trifbot') && (ask[1].toLowerCase() == 'withdraw') && (ask[2].toLowerCase() == 'all') && (ask[3].length==34)) {
				type = 'withdraw_all';
				timerPrevious = timerCurrent; //reset timer
		} else if ((timerCurrent - timerPrevious >= minTime)  && (ask.length == 5) && ask[0].toLowerCase() == 'trifbot' && ask[1].toLowerCase() == 'withdraw' && isNumber(ask[2]) && (ask[4].length==34)) {
			if (parseInt(ask[2]) < 1 || !Number.isInteger(Number(ask[2]))) {
				type = 'badnum';
			} else if (tokenIDLookup(ask[3].toLowerCase()).length != 38){
				type = 'badtokencode';
			} else {
				type = 'withdraw';
				timerPrevious = timerCurrent; //reset timer
			}
		} else if (ask.length > 2 && ask[0].toLowerCase() == 'trifbot' && ask[1].toLowerCase() == 'withdraw') {
			type = 'badwithdrawformat';
		} else if (ask.length == 2 && ask[0].toLowerCase() == 'trifbot' && ask[1].toLowerCase() == 'deposit') {
			type = 'deposit';
		} else if ((timerCurrent - timerPrevious >= minTime)  && ask.length == 3 && ask[0].toLowerCase() == 'trifbot' && ask[1].toLowerCase() == 'supply') {
			type = 'supply';
			timerPrevious = timerCurrent; //reset timer
		} else if ((timerCurrent - timerPrevious < minTime) && ask[0].toLowerCase() == 'trifbot') {
			type = 'toofast';
		}  else if (ask[0].toLowerCase() == 'trifbot') {
			type = 'malformed';
		}
		//timerPrevious = timerCurrent; //reset timer -- moved this up to only the API-calling cases

		switch(type) {
			case 'selftip':
				msg = 'Cannot tip yourself.'
				rtm.sendMessage(msg, conversationId);
				break;
			case 'wrongname':
				msg = 'Beep Boop. Trying to tip NTP1 tokens? Use `Trifbot` as the first word!'
				rtm.sendMessage(msg, conversationId);
				break;
			case 'tip':
				msg = '<@' + event.user + '> tipping <@' + tip_to + '>!';
				var main_nebl_user = 'MAIN';
				var inputs = {
					nebl_userid: "'"+main_nebl_user+"'",
					ntp1_from_userid: "'"+event.user.toUpperCase()+"'",
					ntp1_to_userid: "'"+tip_to.toUpperCase()+"'",
					ntp1_to_address: '',
					token_id: tokenIDLookup(ask[4].toLowerCase()),
					ntp1_send_amount_request: parseInt(ask[3])
				};
				if (inputs.token_id.length === 38){
					withdraw(inputs);
					rtm.sendMessage(msg, conversationId);
				}
				break;
			case 'badtipformat':
				msg = 'Beep! Boop! Looks like you tried to tip but the format is a bit off.. \r use `trifbot tip <@validusername> <integer> <NTP1>`';
				rtm.sendMessage(msg, conversationId);
				break;
			case 'badwithdrawformat':
				msg = 'Beep! Boop! Looks like you tried to withdraw but the format is a bit off.. \r use `trifbot withdraw <integer> <NTP1> <validneblioaddress>`';
				rtm.sendMessage(msg, conversationId);
				break;
			case 'help':
				msg = 'I only deal with NTP1 tokens for now, so please do not deposit any NEBL.\rValid commands are: \r `trifbot help` \r `trifbot tip <@validusername> <integer> <NTP1 token code>` \r `trifbot balance` \r `trifbot withdraw <integer> <NTP1 token code> <valid neblio address>` \r `trifbot withdraw all <valid neblio address>`\r `trifbot deposit` \r `trifbot supply <NTP1 token code>`';
				rtm.sendMessage(msg, conversationId);
				break;
			case 'balance':
				var holdings = calculateNTP1Holdings("'"+event.user+"'")
				holdings.then(
					function(hold) {	
						var token_ids = Object.keys(hold['tokenholdings'][0])
						if (token_ids.length == 0) {
							msg = '<@' + event.user + '> you do not have any NTP1 tokens, try depositing!';
							rtm.sendMessage(msg, conversationId);
						} else {
							msg = 'Holdings:\rUsername: <@' + event.user + '>\r';
							for (var i = 0, len = token_ids.length; i < len; i++) {
								tokid = token_ids[i]
								tokcode = tokenCodeLookup(tokid)
								msg = msg + tokcode + ': ' + JSON.stringify(hold['tokenholdings'][0][tokid]) + '\r'
							}
							rtm.sendMessage(msg, conversationId);
						}
					},function(err) {
						console.log(err);
					})
				break;
			case 'withdraw':
				msg = '<@' + event.user + '> Withdrawing to ' + ask[4];
				var main_nebl_user = 'MAIN';
				var inputs = {
					nebl_userid: "'"+main_nebl_user+"'",
					ntp1_from_userid: "'"+event.user.toUpperCase()+"'",
					ntp1_to_userid: '',
					ntp1_to_address: ask[4],
					token_id: tokenIDLookup(ask[3].toLowerCase()),
					ntp1_send_amount_request: parseInt(ask[2])
				};
				if (inputs.token_id.length === 38){
					withdraw(inputs);
					rtm.sendMessage(msg, conversationId);
				}
				break;
			case 'withdraw_all':
				msg = '<@' + event.user + '> Withdrawing all to ' + ask[3];
				rtm.sendMessage(msg, conversationId);
				withdrawAllTokens(event.user, ask[3]);
				break;
			case 'deposit':
				var getAddressDetails = getAddressParams("'"+event.user+"'");
				getAddressDetails.then(
					function(address_details) {
						msg = '<@' + event.user + '> your deposit address is \r' + address_details.address;
						rtm.sendMessage(msg, conversationId);
					}, function(err) {
						console.log(err);
					})
				break;
			case 'badnum':
				msg = 'Retry -- All numbers must be positive integers';
				rtm.sendMessage(msg, conversationId);
				break;
			case 'usernotfound':
				msg = 'Retry -- that user is invalid';
				rtm.sendMessage(msg, conversationId);
				break;
			case 'malformed':
				msg = 'Doing nothing! Try `trifbot help` for a list of valid commands.';
				rtm.sendMessage(msg, conversationId);
				break;
			case 'badtokencode':
				msg = 'Check NTP1 token code -- was it missing or invalid?';
				rtm.sendMessage(msg, conversationId);
				break;	
			case 'supply':
				var supplyPromise = getSupply(tokenIDLookup(ask[2].toLowerCase()))
				supplyPromise.then(
					function(supply) {
						if (supply.hasOwnProperty('tokenId') && supply.hasOwnProperty('holders') && supply.holders.length > 0){
							sum = supply.holders.reduce((total, obj) => obj.amount + total,0)
							msg = 'Number of Holders of ' + ask[2] + ': ' + supply.holders.length + '\rTotal Supply: ' + sum
							rtm.sendMessage(msg, conversationId);	
						}
					}, function(err) {
						console.log(err);
						rtm.sendMessage('API Error', conversationId);
					})
				break;
			case 'toofast':
				msg = 'Too fast! Only send commands every 2 seconds... remember this is on-chain!'
				rtm.sendMessage(msg, conversationId);
				break;
			default:
				msg = '';
		} // end switch
	}// end if (event.hasOwnProperty('text'))
	}) // end rtm.on({;

//whenever somebody joins the slack, add them to an address and ensure they 
rtm.on('team_join', (event) => {
	console.log(event);
	user = event.user;
	var validateUserPromise = validateUser(user);
	validateUserPromise.then(
		function(succ) {
			backupAddresses();
		}, function(err) {
			console.log(err);
		})
});