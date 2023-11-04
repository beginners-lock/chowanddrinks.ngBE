import express, { response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { parse } from 'csv-parse';
import fs from 'fs';
import * as https from 'https';
import * as ElasticEmail from '@elasticemail/elasticemail-client';
import path from 'path';

let defaultClient = ElasticEmail.ApiClient.instance;
 
let EE_apikey = defaultClient.authentications['apikey'];
EE_apikey.apiKey = process.env.ELASTIC_EMAIL_API_KEY;

//Sets the process.env path
dotenv.config({path: `./.env`});

const prisma = new PrismaClient();
const app = express();
app.use('/public', express.static('public'));
//app.use(express.json()); // For parsing application/json
//app.use(express.urlencoded({ extended: true})); //For parsing application/x-www-form-urlencoded
app.use(cors({origin: "*"}));

const CATEGORIES = ['Rice', 'Pasta', 'Beans', 'Tubers', 'Nigerian Staples', 'Nigerian Soups', 'Stew & Sauce', 'Proteins', 'Finger Foods', 'Side Dish', 'Malt'];

app.post('/usercreate', bodyParser.json(), async (req, res)=>{
    console.log('create');
    try{
        let password = await bcrypt.hash(req.body.pass1, 10);

        let reply = await confirmcode(req.body.email, req.body.code);
        
        if(reply==='Email Verified'){
            let user = await prisma.user.create({
                data:{
                    email: req.body.email,
                    password: password
                }
            });

            await sendNotification(user.userid, 'User email verified');
            await sendNotification(user.userid, 'User account created');

            delete user.password;
            res.send({msg: reply, user:user});
        }else{
            res.send({msg: reply});
        }

    }catch(e){
        console.log('Error occured at /usercreate: '+e);
        res.send({msg: e});    
    }
});

app.post('/userlogin', bodyParser.json(), async (req, res)=>{
    console.log('login');
    try{
        let user = await prisma.user.findFirst({
            where:{
                email: req.body.email
            }
        });
    
        if(user){
            let result = await bcrypt.compare(req.body.pass1, user.password);
            if(result){
                await sendNotification(user.userid, 'User logged in');

                delete user.password;
                res.send({msg: 'success', user:user});
            }else{
                res.send({msg: 'Wrong credentials'});
            }
        }else{
            res.send({msg: 'Email does not exist'});
        }
    }catch(e){
        console.log('Error in /userlogin: '+e);
    }
});

app.post('/loadcategories', bodyParser.json(), async (req, res)=>{
    try{
        let arranged = CATEGORIES.sort();
    
        //Get the menu under the first category(in alphabetical order)
        let menu = await prisma.menu.findMany({
            where: {
                category: {
                    equals: arranged[0]
                }
            }
        });

        res.send({msg:'success', categories: arranged, menu: menu});
    }catch(error){
        console.log('Error occured in /loadcategories: '+error);
        res.send({msg:'An error occured, please try again later.'});
    }
});

app.post('/loadcategorymenu', bodyParser.json(), async (req, res)=>{
    try{
        let menu = await prisma.menu.findMany({
            where:{
                category: {
                    equals: req.body.category
                }
            }
        });

        res.send({msg: 'success', menu:menu});
    }catch(error){
        console.log('Error occured in /loadcategorymenu: '+error);
        res.send({msg:'An error occured, please try again later.'});
    }
});

app.post('/emailverification', bodyParser.json(), async (req, res)=>{
    try{
        let similaremail = await similarEmails(req.body.email);
        console.log(similaremail);
        if(!similaremail){
            let reply = await sendcode(req.body.email);
            console.log(reply);
            if(reply === 'success'){
                res.send({msg: 'success'});
            }else{
                res.send({msg: 'An error occured, please try again later.'});
            }
        }else{
            res.send({msg: 'This email already exists'});
        }

    }catch(e){
        console.log('Error occured in /emailverification: '+e);
        res.send({msg:'An error occured while processing'});
    }
});

app.post('/passwordemail', bodyParser.json(), async (req, res)=>{
    try{
        let similaremail = await similarEmails(req.body.email);
        console.log(similaremail);
        if(similaremail){
            let reply = await sendcode(req.body.email);
            console.log(reply);
            if(reply === 'success'){
                res.send({msg: 'success'});
            }else{
                res.send({msg: 'An error occured, please try again later.'});
            }
        }else{
            console.log('desnt');
            res.send({msg: 'This email does not exist'});
        }
    }catch(e){
        console.log('Error occured in /passwordemail: '+e);
        res.send({msg:'An error occured while processing'});
    }
});

app.post('/forgotpassword', bodyParser.json(), async (req, res) => {
    try{
        let reply = await confirmcode(req.body.email, req.body.code);

        if(reply==='Email Verified'){
            res.send({msg: 'success'});
        }else{
            res.send({msg: reply});
        }
    }catch(e){
        console.log('An error occured in /forgotpassword: '+e);
        res.send({msg: 'An error occured, please try again later'});
    }
});

app.post('/changepassword', bodyParser.json(), async (req, res) => {
    try{
        if(req.body.current){
            let user = await prisma.user.findFirst({where: {email: req.body.email}});
            let result = await bcrypt.compare(req.body.current, user.password);

            if(result){
                let newpassword = await bcrypt.hash(req.body.pass1, 10);

                let action = await prisma.user.updateMany({
                    where: {
                        email: req.body.email
                    },
                    data: {
                        password: newpassword
                    }
                });
    
                await sendNotification(user.userid, 'Account password changed');       
    
                res.send({msg:'success'});
            }else{
                res.send({msg:'Wrong password'}); 
            }
        }else{
            let password = await bcrypt.hash(req.body.pass1, 10);

            let action = await prisma.user.updateMany({
                where: {
                    email: req.body.email
                },
                data: {
                    password: password
                }
            });

            let user = await prisma.user.findFirst({where:{email: req.body.email}});

            await sendNotification(user.userid, 'Account password changed');       

            res.send({msg:'success'});
        }
    }catch(e){
        console.log('An error occured in /changepassword: '+e);
        res.send({msg: 'An error occured, please try again later'});
    }
});

app.post('/unseennotifics', bodyParser.json(), async (req, res) => {
    try{
        let unseennotifics = await prisma.notification.findFirst({
            where: {
                email: req.body.email,
                status: 'unseen'
            }
        });
        
        if(unseennotifics){
            res.send({new: true});
        }else{
            res.send({new: false});
        }
    }catch(e){
        console.log('An error occured in /unseennotifics: '+e);
        res.send({new: false});
    }
});

app.post('/getnotifications', bodyParser.json(), async (req, res) => {
    try{
        let notifications = await prisma.notification.findMany({
            where: {
                ownerid: req.body.userid
            }
        });

        let update = await prisma.notification.updateMany({
            where: {
                ownerid: req.body.userid,
                status: 'unseen'
            },
            data: {
                status: 'seen'
            }
        });

        res.send({msg: 'success', data: notifications});
    }catch(e){
        console.log('An error occured in /getnotifications: '+e);
        res.send({msg: 'An error occured, please try again later.'})
    }
});

app.post('/getorderhistory', bodyParser.json(), async (req, res) => {
    try{
        let orders = await prisma.order.findMany({
            where: {
                ownerid: req.body.userid,
                status: 'confirmed'
            }
        });

        res.send({msg: 'success', data: orders});
    }catch(e){
        console.log('An error occured in /getnotifications: '+e);
        res.send({msg: 'An error occured, please try again later.'})
    }
});

app.post('/makepayment', bodyParser.json(), async (req, res)=>{
    try{
        console.log('//amount: '+req.body.email);
        const params = JSON.stringify({
            "email": req.body.email,
            "amount": req.body.amount*100,//500,
            "callback_url": process.env.FRONTEND_URL,
            "metadata": JSON.stringify({userid: req.body.userid, email: req.body.email})
        });
        
        fetch(
            'https://api.paystack.co/transaction/initialize',
            {
                method: 'POST',  
                body: params,
                headers: {
                    Authorization: 'Bearer '+process.env.PAYSTACK_API_KEY,
                    'Content-Type': 'application/json'
                } 
            }
        ).then(response=>{
            return response.json();
        }).then(async response=>{
            console.log(response);
            if(response.status===true){
                let order = await prisma.order.create({
                    data: {
                        ownerid: req.body.userid,
                        list: req.body.list,
                        status: 'pending',
                        reference: response.data.reference,
                        total: 5,//req.body.amount //Original amount was multiplied by 100   
                        
                    }
                });

                res.send({msg:'success', data: response, pendingorder: order});
            }else{
                res.send({msg:'An error occured, please try again'});
            }
        });
    }catch(e){
        console.log('An error occured at /makepayment: '+e);
        res.send({msg:'An error occured, please try again'});
    }
});

app.post('/paymenthook', bodyParser.json(), async (req, res)=>{
    console.log('paymenthook');
    let paystack = req.body;
    console.log(paystack);
    if(paystack.event==='charge.success'){
        let order = await prisma.order.findFirst({
            where:{
                reference: paystack.data.reference,
                status: 'pending'
            }
        });

        
        let usermeta = paystack.data.metadata;

        //Check if what was paid equals what is meant to be paid
        let paid = order.paid + (paystack.data.amount/100);
        if( paid >= order.total){
            //Update prisma db
            let action1 = await prisma.order.updateMany({
                where: {
                    reference: paystack.data.reference,
                    status: 'pending'
                }, 
                data: {
                    status: 'confirmed',
                    paid: paid
                }
            });

            //Update notification
            let message = 'Order '+paystack.data.reference+' payment confirmed';
            let type = JSON.stringify({userid: usermeta.userid, reference: paystack.data.reference});
            let action2 = await prisma.notification.create({
                data: {
                    ownerid: usermeta.userid,
                    message: message,
                    status: 'unseen',
                    type: type
                }
            });

            //Send email
            let urlstring = process.env.BACKEND_URL+'/orderreview?reference='+paystack.data.reference+'&userid='+usermeta.userid;
            console.log(urlstring);
            sendOrderEmail(urlstring, usermeta.email);
        }else{
            //Update prisma db
            let action1 = await prisma.order.updateMany({
                where: {
                    reference: paystack.data.reference,
                    status: 'pending'
                }, 
                data: {
                    paid: paid
                }
            });
        }
    }

    res.sendStatus(200);
});

app.get('/orderreview', async (req, res)=>{
    let reference = req.query.reference;
    let userid=req.query.userid;

    //Get order
    let order = await prisma.order.findFirst({
        where: {
            ownerid: userid,
            reference: reference,
            status: 'confirmed'
        }
    });

    if(order){
        let arr = JSON.parse(order.list);
        let html = orderTableGen(arr, order.address);


        res.status(200).send(html);
    }
});

app.get('/checker', (req, res) => {
    res.send('bruhhh...:)');
});


app.get('/', (req, res) => {
    res.send('I see youuu....:)');
});

app.listen(process.env.APP_PORT, ()=>{
    console.log('Listening on port 8000...');
});

async function sendNotification(userid, message){
    try{
        let notific = await prisma.notification.create({
            data: {
                ownerid: userid,
                message: message,
                status: 'unseen',
            }
        }); 

        return true;
    }catch(e){
        console.log('Error occured in sendNotification(): '+e);
        return false;
    }
}

function orderTableGen(arr, address){
    let html = '<html><div>Address: '+address+'<div><table style="width:98vw; height:auto; overflow-y:auto;"><tr><th style="text-align:left;">Order</th><th style="text-align:left;">Plates</th><th style="text-align:left;">Cost</th></tr>';

    for(let i=0; i<arr.length; i++){
        let row = '<tr>';
        row+=( '<td>'+arr[i].names.join(' , ')+'</td><td>'+arr[i].plates+'</td><td>'+(( arr[i].prices.reduce((acc, val)=>{return acc+parseInt(val) ;}, 0) )*arr[i].plates).toString()+'</td>' );
        row+='</tr>';
        html+=row;
    }

    html+='</table></html>';

    return html;
}

async function sendOrderEmail(link, email){
    try{    
        let api = new ElasticEmail.EmailsApi()

        let message = ElasticEmail.EmailMessageData.constructFromObject({
            Recipients: [
                new ElasticEmail.EmailRecipient('billings@chowanddrinks.com.ng'),
                new ElasticEmail.EmailRecipient(email)
            ],
            Content: {
                Body: [
                    ElasticEmail.BodyPart.constructFromObject({
                        ContentType: "HTML",
                        Content: "<html><a href='"+link+"'>Order Invoice</a></html>"
                    })
                ],
                Subject: "chowanddrinks.ng Order Invoice",
                From: "billings@chowanddrinks.com.ng"
            }
        });
        
        api.emailsPost(message, async ()=>{});

        return 'success';
    }catch(e){
        console.log('An error occured in sendOrderEmail(): '+e);
        return 'An error occured, please try again later';
    }
}

async function similarEmails(email){
    let action = await prisma.user.findFirst({
        where:{
            email: email
        }
    });

    if(action){
        return true;
    }else{
        return false;
    }
}

async function sendcode(email){
    try{
        let randomnum = Math.floor((Math.random() * (999999-100000+1))+100000) //Generates random numbers between 100000 and 999999
    
        let api = new ElasticEmail.EmailsApi()

        let message = ElasticEmail.EmailMessageData.constructFromObject({
            Recipients: [
                new ElasticEmail.EmailRecipient(email)
            ],
            Content: {
                Body: [
                    ElasticEmail.BodyPart.constructFromObject({
                        ContentType: "HTML",
                        Content: (randomnum).toString()
                    })
                ],
                Subject: "chowanddrinks.ng Email Verification",
                From: "billings@chowanddrinks.com.ng"
            }
        });
        
        api.emailsPost(message, async ()=>{
            //set all previously sent mails to this email to 'cancelled'
            let action1 = await prisma.emailVerification.updateMany({
                where:{
                    email: email
                },
                data: {
                    status: 'cancelled'
                }
            });
            
            //Add a new row to emailverification.
            let action2 = await prisma.emailVerification.create({
                data: {
                    email: email,
                    code: randomnum.toString(),
                    status: 'pending'
                }
            });
        });

        return 'success';
    }catch(e){
        console.log('An error occured in sendcode(): '+e);
        return 'An error occured, please try again later';
    }
}

async function confirmcode(email, code){
    try{
        let valid = await prisma.emailVerification.updateMany({
            where: {
                email: email,
                code: code,
                status: 'pending'
            },
            data: {
                status: 'verified'
            }
        });
        if(valid.count>0){
            return 'Email Verified';
        }else{
            return 'Wrong Code';
        }
    }catch(e){
        console.log('An error occured in confirmcode(): '+e);
        return 'An error occured, please try again later.';
    }
}

/*function menuresolver(){
    let arr = [];
    fs.createReadStream(
        './candd.csv'
    ).pipe(
        parse({delimiter: ',', columns:true, ltrim:true})
    ).on('data', (row)=>{
        arr.push(row);
    }).on('error', (error)=>{
        console.log(error.message);
    }).on('end', async ()=>{
        for(let i=0; i<arr.length; i++){
            let row = await prisma.menu.create({
                data: {
                    name:arr[i].Name,
                    price:parseInt(arr[i].Price),
                    category:arr[i].Category
                }
            });
        }
    });
}

menuresolver();*/