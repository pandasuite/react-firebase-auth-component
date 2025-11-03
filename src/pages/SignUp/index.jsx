import React, { useContext } from 'react';
import { useIntl } from 'react-intl';
import { useHistory } from 'react-router-dom';

import { Form, Card, Button, Alert } from 'tabler-react';

import { useFormik } from 'formik';
import * as Yup from 'yup';
import _ from 'lodash';
import PandaBridge from 'pandasuite-bridge';

import * as ROUTES from '../../constants/routes';
import StandaloneFormPage from '../StandaloneFormPage';
import FirebaseBridgeContext from '../../FirebaseBridgeContext';

const SignUp = () => {
  const firebaseWithBridge = useContext(FirebaseBridgeContext);
  const intl = useIntl();
  const history = useHistory();

  const { auth, firestore, bridge } = firebaseWithBridge || {};
  const { properties } = bridge || {};
  const { [PandaBridge.LANGUAGE]: language } = properties || {};
  const termsValidationSchema = {
    terms: Yup.bool()
      .required(intl.formatMessage({ id: 'form.required' }))
      .oneOf(
        [true],
        intl.formatMessage({ id: 'page.signup.form.input.terms.error' }),
      ),
  };

  // Build dynamic validation schema for custom fields
  const buildDynamicValidationSchema = () => {
    const customFieldsSchema = {};

    if (properties && properties.fields && Array.isArray(properties.fields)) {
      properties.fields.forEach((field) => {
        if (field.required) {
          if (field.fieldType === 'checkbox') {
            customFieldsSchema[field.id] = Yup.bool();
          } else {
            customFieldsSchema[field.id] = Yup.string().required(
              intl.formatMessage({ id: 'form.required' }),
            );
          }
        }
      });
    }

    return customFieldsSchema;
  };

  // Build initial values including dynamic fields
  const buildInitialValues = () => {
    const initialValues = {};

    if (properties && properties.fields && Array.isArray(properties.fields)) {
      properties.fields.forEach((field) => {
        if (field.fieldType === 'checkbox' && field.value !== undefined) {
          initialValues[field.id] = field.value;
        } else {
          initialValues[field.id] = '';
        }
      });
    }

    return initialValues;
  };

  const formik = useFormik({
    initialValues: buildInitialValues(),
    validationSchema: Yup.object(
      _.merge(
        {
          name: Yup.string().required(
            intl.formatMessage({ id: 'form.required' }),
          ),
          email: Yup.string()
            .required(intl.formatMessage({ id: 'form.required' }))
            .email(
              intl.formatMessage({ id: 'page.signup.form.input.email.error' }),
            ),
          password: Yup.string().required(
            intl.formatMessage({ id: 'form.required' }),
          ),
        },
        properties && properties.terms ? termsValidationSchema : {},
        properties && properties.advancedFields
          ? buildDynamicValidationSchema()
          : {},
      ),
    ),
    onSubmit: (values) => {
      const { name, email, password } = values;
      const customFields = {};

      // Extract custom fields from values
      if (properties && properties.fields && Array.isArray(properties.fields)) {
        properties.fields.forEach((field) => {
          if (values[field.id] !== undefined) {
            customFields[field.id] = values[field.id];
          }
        });
      }

      auth
        .createUserWithEmailAndPassword(email, password)
        .then(() => {
          const { currentUser } = auth;
          const fields = {
            name,
            email,
            ...customFields,
          };
          const requiresEmailVerification =
            properties.verifyEmail === true ||
            (properties.session &&
              properties.session.properties &&
              properties.session.properties.verifyEmail === true);

          if (requiresEmailVerification && !currentUser.emailVerified) {
            currentUser.sendEmailVerification();
          }

          firestore
            .collection('users')
            .doc(currentUser.uid)
            .set(fields)
            .then(() => {
              formik.setSubmitting(false);
            })
            .catch(() => {
              formik.setSubmitting(false);
            });
        })
        .catch((error) => {
          formik.setErrors({ global: error });
          formik.setSubmitting(false);
        });
    },
  });

  // Render a form field based on its type
  const renderField = (field, index) => {
    const locale = language;

    // Get localized label or fallback to default
    const fieldLabel =
      field.locale_label && field.locale_label[locale]
        ? field.locale_label[locale]
        : field.label;

    // Get localized placeholder or fallback to default
    const fieldPlaceholder =
      field.locale_placeholder && field.locale_placeholder[locale]
        ? field.locale_placeholder[locale]
        : field.placeholder;

    switch (field.fieldType) {
      case 'textarea':
        return (
          <Form.Group
            key={`custom-field-${index}`}
            label={fieldLabel}
            isRequired={field.required}
          >
            <Form.Textarea
              name={field.id}
              placeholder={fieldPlaceholder}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              value={formik.values && formik.values[field.id]}
              error={formik.errors && formik.errors[field.id]}
              disabled={formik.isSubmitting}
              isRequired={field.required}
            />
          </Form.Group>
        );
      case 'checkbox':
        return (
          <Form.Group key={`custom-field-${index}`}>
            <label className="custom-control custom-checkbox">
              <Form.Input
                type="checkbox"
                name={field.id}
                checked={formik.values && formik.values[field.id]}
                error={formik.errors && formik.errors[field.id]}
                disabled={formik.isSubmitting}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                isRequired={field.required}
              />
              <span className="custom-control-label">{fieldLabel}</span>
            </label>
          </Form.Group>
        );
      default: // 'text' or any other type defaults to text input
        return (
          <Form.Group
            key={`custom-field-${index}`}
            label={fieldLabel}
            isRequired={field.required}
          >
            <Form.Input
              name={field.id}
              placeholder={fieldPlaceholder}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              value={formik.values && formik.values[field.id]}
              error={formik.errors && formik.errors[field.id]}
              disabled={formik.isSubmitting}
              isRequired={field.required}
            />
          </Form.Group>
        );
    }
  };

  return (
    <StandaloneFormPage>
      <Form className="card" onSubmit={formik.handleSubmit}>
        <Card.Body className="p-6">
          <Card.Title RootComponent="div">
            {intl.formatMessage({ id: 'page.signup.form.title' })}
          </Card.Title>
          <Form.Group
            label={intl.formatMessage({
              id: 'page.signup.form.input.name.label',
            })}
            isRequired
          >
            <Form.Input
              name="name"
              placeholder={intl.formatMessage({
                id: 'page.signup.form.input.name.placeholder',
              })}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              value={formik.values && formik.values.name}
              error={formik.errors && formik.errors.name}
              disabled={formik.isSubmitting}
              isRequired
            />
          </Form.Group>
          <Form.Group
            label={intl.formatMessage({
              id: 'page.signup.form.input.email.label',
            })}
            isRequired
          >
            <Form.Input
              name="email"
              placeholder={intl.formatMessage({
                id: 'page.signup.form.input.email.placeholder',
              })}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              value={formik.values && formik.values.email}
              error={formik.errors && formik.errors.email}
              disabled={formik.isSubmitting}
            />
          </Form.Group>
          <Form.Group
            label={intl.formatMessage({
              id: 'page.signup.form.input.password.label',
            })}
            isRequired
          >
            <Form.Input
              name="password"
              type="password"
              placeholder={intl.formatMessage({
                id: 'page.signup.form.input.password.placeholder',
              })}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              value={formik.values && formik.values.password}
              error={formik.errors && formik.errors.password}
              disabled={formik.isSubmitting}
            />
          </Form.Group>
          {properties &&
            properties.advancedFields &&
            properties.fields &&
            Array.isArray(properties.fields) && (
              <>
                {properties.fields.map((field, index) =>
                  renderField(field, index),
                )}
              </>
            )}
          {properties && properties.terms && (
            <>
              <label className="custom-control custom-checkbox">
                <Form.Input
                  type="checkbox"
                  name="terms"
                  value={formik.values && formik.values.terms}
                  error={formik.errors && formik.errors.terms}
                  disabled={formik.isSubmitting}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  isRequired
                />
                <span className="custom-control-label">
                  <Button
                    className="p-0 m-0"
                    link
                    href="#"
                    onClick={() => {
                      PandaBridge.send('onTermsClicked');
                      return false;
                    }}
                  >
                    {intl.formatMessage({ id: 'page.signup.form.terms' })}
                  </Button>
                </span>
              </label>
            </>
          )}
          {formik.errors && formik.errors.global && (
            <Alert type="danger" className="mt-6" isDismissible>
              {formik.errors.global.message}
              {['auth/wrong-password', 'auth/invalid-credential'].includes(
                formik.errors.global.code,
              ) && (
                <>
                  <br />
                  <Button
                    link
                    className="p-0"
                    href="#"
                    onClick={() => {
                      history.push(
                        `${ROUTES.PASSWORD_FORGET}/${
                          formik.values && formik.values.email
                        }`,
                      );
                    }}
                  >
                    {intl.formatMessage({
                      id: 'page.signup.form.forgot.label',
                    })}
                  </Button>
                </>
              )}
            </Alert>
          )}
          <Form.Footer>
            <Button
              type="submit"
              color="primary"
              loading={formik.isSubmitting}
              disabled={
                formik.isSubmitting ||
                _.isEmpty(formik.values) ||
                !_.isEmpty(formik.errors)
              }
              block
            >
              {intl.formatMessage({ id: 'page.signup.form.button' })}
            </Button>
          </Form.Footer>
          <div className="row row gutters-xs align-items-center mt-5">
            <div className="col col-auto">
              {intl.formatMessage({ id: 'page.signup.form.signin.label' })}
            </div>
            <Button
              link
              className="p-0"
              href="#"
              onClick={() => {
                history.push(ROUTES.SIGN_IN);
              }}
            >
              {intl.formatMessage({ id: 'page.signup.form.signin.action' })}
            </Button>
          </div>
        </Card.Body>
      </Form>
    </StandaloneFormPage>
  );
};

export default SignUp;
