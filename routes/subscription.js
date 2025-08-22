const express = require('express');
const axios = require('axios');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Konnect API configuration
const KONNECT_CONFIG = {
  merchantId: process.env.KONNECT_MERCHANT_ID,
  secretKey: process.env.KONNECT_SECRET_KEY,
  apiUrl: process.env.KONNECT_API_URL
};

// Subscription plans configuration (in TND - Tunisian Dinar)
const SUBSCRIPTION_PLANS = {
  basic: {
    name: 'Basic Plan',
    price: 30.00, // 30 TND
    currency: 'TND',
    messagesPerMonth: 100,
    features: ['100 messages per month', 'GPT-4o Mini', 'Basic support'],
    description: 'Perfect for casual users'
  },
  premium: {
    name: 'Premium Plan',
    price: 60.00, // 60 TND
    currency: 'TND',
    messagesPerMonth: 1000,
    features: ['1000 messages per month', 'All GPT models', 'Priority support', 'Advanced features'],
    description: 'Best for power users and professionals'
  }
};

// Get available subscription plans
router.get('/plans', (req, res) => {
  res.json({
    success: true,
    plans: SUBSCRIPTION_PLANS
  });
});

// Create checkout session with Konnect
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;

    if (!SUBSCRIPTION_PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan selected.' });
    }

    const planDetails = SUBSCRIPTION_PLANS[plan];
    
    // Create Konnect payment request
    const paymentData = {
      merchantId: KONNECT_CONFIG.merchantId,
      amount: planDetails.price,
      currency: planDetails.currency,
      orderId: `sub_${Date.now()}_${req.user._id}`,
      orderDescription: `${planDetails.name} - ${planDetails.description}`,
      customerEmail: req.user.email,
      customerName: req.user.username,
      customerPhone: req.user.phone || '',
      returnUrl: `${req.protocol}://${req.get('host')}/subscription/success`,
      cancelUrl: `${req.protocol}://${req.get('host')}/subscription/cancel`,
      notifyUrl: `${req.protocol}://${req.get('host')}/api/subscription/webhook`,
      metadata: {
        userId: req.user._id.toString(),
        plan: plan,
        type: 'subscription'
      }
    };

    // Generate signature for Konnect
    const signature = generateKonnectSignature(paymentData, KONNECT_CONFIG.secretKey);
    paymentData.signature = signature;

    // Make request to Konnect API
    const response = await axios.post(`${KONNECT_CONFIG.apiUrl}/payments`, paymentData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KONNECT_CONFIG.secretKey}`
      }
    });

    if (response.data.success) {
      // Store pending subscription in user record
      req.user.subscription = {
        plan: plan,
        status: 'pending',
        konnectOrderId: paymentData.orderId,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      };
      await req.user.save();

      res.json({
        success: true,
        paymentUrl: response.data.paymentUrl,
        orderId: paymentData.orderId
      });
    } else {
      res.status(400).json({ error: 'Failed to create payment session.' });
    }
  } catch (error) {
    console.error('Create checkout session error:', error);
    res.status(500).json({ error: 'Error creating checkout session.' });
  }
});

// Konnect webhook handler
router.post('/webhook', async (req, res) => {
  try {
    const { orderId, status, signature, amount, currency } = req.body;

    // Verify webhook signature
    const expectedSignature = generateKonnectSignature(req.body, KONNECT_CONFIG.secretKey);
    if (signature !== expectedSignature) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Find user by order ID
    const user = await User.findOne({ 'subscription.konnectOrderId': orderId });
    if (!user) {
      console.error('User not found for order:', orderId);
      return res.status(404).json({ error: 'User not found' });
    }

    if (status === 'SUCCESS') {
      // Payment successful - activate subscription
      user.subscription.status = 'active';
      user.subscription.currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      user.subscription.lastPaymentDate = new Date();
      user.subscription.lastPaymentAmount = amount;
      user.subscription.lastPaymentCurrency = currency;
      
      await user.save();
      
      console.log(`Subscription activated for user: ${user.email}`);
    } else if (status === 'FAILED') {
      // Payment failed - mark as failed
      user.subscription.status = 'failed';
      await user.save();
      
      console.log(`Payment failed for user: ${user.email}`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed.' });
  }
});

// Check payment status
router.get('/payment-status/:orderId', requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;

    // Check if this order belongs to the current user
    if (req.user.subscription.konnectOrderId !== orderId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // Query Konnect API for payment status
    const response = await axios.get(`${KONNECT_CONFIG.apiUrl}/payments/${orderId}`, {
      headers: {
        'Authorization': `Bearer ${KONNECT_CONFIG.secretKey}`
      }
    });

    if (response.data.success) {
      const paymentStatus = response.data.payment.status;
      
      // Update user subscription based on payment status
      if (paymentStatus === 'SUCCESS' && req.user.subscription.status === 'pending') {
        req.user.subscription.status = 'active';
        req.user.subscription.currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await req.user.save();
      }

      res.json({
        success: true,
        status: paymentStatus,
        subscription: req.user.subscription
      });
    } else {
      res.status(400).json({ error: 'Failed to get payment status.' });
    }
  } catch (error) {
    console.error('Payment status check error:', error);
    res.status(500).json({ error: 'Error checking payment status.' });
  }
});

// Cancel subscription
router.post('/cancel', requireAuth, async (req, res) => {
  try {
    if (req.user.subscription.status !== 'active') {
      return res.status(400).json({ error: 'No active subscription to cancel.' });
    }

    // Mark subscription as canceled (will expire at current period end)
    req.user.subscription.status = 'canceled';
    await req.user.save();

    res.json({
      success: true,
      message: 'Subscription will be canceled at the end of the current period.',
      currentPeriodEnd: req.user.subscription.currentPeriodEnd
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Error canceling subscription.' });
  }
});

// Reactivate subscription
router.post('/reactivate', requireAuth, async (req, res) => {
  try {
    if (req.user.subscription.status !== 'canceled') {
      return res.status(400).json({ error: 'No canceled subscription to reactivate.' });
    }

    // For reactivation, user needs to make a new payment
    res.json({
      success: true,
      message: 'Please create a new subscription to reactivate your account.',
      requiresNewPayment: true
    });
  } catch (error) {
    console.error('Reactivate subscription error:', error);
    res.status(500).json({ error: 'Error reactivating subscription.' });
  }
});

// Get subscription status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('subscription usage');
    
    res.json({
      success: true,
      subscription: user.subscription,
      usage: user.usage,
      limits: {
        free: 20,
        basic: 100,
        premium: 1000
      }
    });
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({ error: 'Error fetching subscription status.' });
  }
});

// Helper function to generate Konnect signature
function generateKonnectSignature(data, secretKey) {
  const crypto = require('crypto');
  
  // Create signature string (adjust based on Konnect's requirements)
  const signatureString = `${data.merchantId}${data.amount}${data.currency}${data.orderId}${data.customerEmail}${secretKey}`;
  
  // Generate SHA256 hash
  return crypto.createHash('sha256').update(signatureString).digest('hex');
}

module.exports = router;
