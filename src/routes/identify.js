const express = require('express');
const router = express.Router();

// In-memory storage
let contacts = [];
let nextId = 1;

router.post('/', (req, res) => {
  const { email, phoneNumber } = req.body;

  // Validation
  if (!email && !phoneNumber) {
    return res.status(400).json({ error: 'At least one contact info required' });
  }

  try {
    // Find matching contacts (email OR phone)
    const matches = contacts.filter(c => 
      (email && c.email === email) || 
      (phoneNumber && c.phoneNumber === phoneNumber)
    );

    // Case 1: No matches → create primary
    if (matches.length === 0) {
      const newContact = {
        id: nextId++,
        email,
        phoneNumber,
        linkPrecedence: 'primary',
        linkedId: null,
        createdAt: new Date()
      };
      contacts.push(newContact);
      
      return res.json({
        contact: {
          primaryContatctId: newContact.id,
          emails: [newContact.email].filter(Boolean),
          phoneNumbers: [newContact.phoneNumber].filter(Boolean),
          secondaryContactIds: []
        }
      });
    }

    // Find primary contact (oldest match)
    const primary = matches.reduce((oldest, current) => 
      current.createdAt < oldest.createdAt ? current : oldest
    );

    // Check if new info needs to be added
    const hasNewInfo = (
      (email && !contacts.some(c => c.email === email)) ||
      (phoneNumber && !contacts.some(c => c.phoneNumber === phoneNumber))
    );

    if (hasNewInfo) {
      const newSecondary = {
        id: nextId++,
        email,
        phoneNumber,
        linkPrecedence: 'secondary',
        linkedId: primary.id,
        createdAt: new Date()
      };
      contacts.push(newSecondary);
    }

    // Get all linked contacts
    const allLinked = contacts.filter(c => 
      c.id === primary.id || c.linkedId === primary.id
    );

    // Prepare response
    const secondaryContacts = allLinked.filter(c => c.id !== primary.id);
    
    res.json({
      contact: {
        primaryContatctId: primary.id,
        emails: Array.from(new Set([
          primary.email,
          ...secondaryContacts.map(c => c.email)
        ].filter(Boolean))),
        phoneNumbers: Array.from(new Set([
          primary.phoneNumber,
          ...secondaryContacts.map(c => c.phoneNumber)
        ].filter(Boolean))),
        secondaryContactIds: secondaryContacts.map(c => c.id)
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;